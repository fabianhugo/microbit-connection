/**
 * (c) 2025, Micro:bit Educational Foundation and contributors
 *
 * SPDX-License-Identifier: MIT
 */

import { Logging } from "./logging.js";
import { BoardSerialInfo } from "./board-serial-info.js";
import { JLinkProtocol } from "./jlink-protocol.js";

/**
 * J-Link USB interface configuration.
 * 
 * Based on USB descriptor for Calliope mini v2:
 * - Interface 0-1: CDC (Serial/UART communication)
 * - Interface 2: Vendor Specific (J-Link commands for debugging/flashing)
 * - Interface 3: Mass Storage (drag-and-drop flashing)
 */
const JLINK_INTERFACE = {
  // CDC Serial interface
  CDC_CONTROL: 0,
  CDC_DATA: 1,
  // J-Link command interface
  JLINK: 2,
  // Mass storage interface
  MSC: 3,
} as const;

// Endpoint numbers are detected dynamically as they vary between hardware versions
// Calliope v2.0: EP 3 IN / EP 2 OUT
// Calliope v2.1: EP 5 IN / EP 4 OUT

/**
 * Wrapper for J-Link USB interface (used by Calliope mini v2).
 * 
 * Unlike DAPLink, J-Link uses SEGGER's proprietary protocol for debugging
 * and flashing, but provides standard CDC ACM for serial communication.
 */
export class JLinkWrapper {
  private initialConnectionComplete: boolean = false;
  private loggedBoardSerialInfo: BoardSerialInfo | undefined;

  // Serial communication state
  private serialListener: ((data: string) => void) | undefined;
  private serialReading: boolean = false;
  private serialReadLoop: Promise<void> | undefined;

  // Detected endpoint numbers (vary by hardware version)
  private cdcInEndpoint: number = 1;
  private cdcOutEndpoint: number = 1;
  private jlinkInEndpoint: number = 3;
  private jlinkOutEndpoint: number = 2;

  // Device info (will be populated on connection)
  _pageSize: number | undefined;
  _numPages: number | undefined;
  _deviceId: number | undefined;

  // J-Link protocol implementation
  private protocol: JLinkProtocol;

  constructor(
    public device: USBDevice,
    private logging: Logging,
  ) {
    // Initialize protocol with command sender
    this.protocol = new JLinkProtocol(this.sendJLinkCommand.bind(this));
  }

  /**
   * The page size. For J-Link devices, this is informational only.
   */
  get pageSize(): number {
    // For Calliope mini v2 (nRF52833), page size is typically 4KB
    // This is informational as J-Link handles flashing differently
    return this._pageSize ?? 4096;
  }

  /**
   * The number of pages.
   */
  get numPages(): number {
    // For Calliope mini v2 (nRF52833), flash is typically 512KB
    // This is informational as J-Link handles flashing differently
    return this._numPages ?? 128; // 512KB / 4KB
  }

  /**
   * The device ID.
   */
  get deviceId(): number | undefined {
    return this._deviceId;
  }

  get boardSerialInfo(): BoardSerialInfo {
    return BoardSerialInfo.parse(
      this.device,
      this.logging.log.bind(this.logging),
    );
  }

  /**
   * Connect or reconnect to the J-Link device.
   */
  async reconnectAsync(): Promise<void> {
    if (this.initialConnectionComplete) {
      await this.disconnectAsync();
    } else {
      this.initialConnectionComplete = true;
    }

    // Open the device if not already open
    if (!this.device.opened) {
      await this.device.open();
    }

    // Select configuration 1
    if (this.device.configuration === null) {
      await this.device.selectConfiguration(1);
    }

    // Log device configuration for debugging
    this.logging.log(`Device has ${this.device.configuration?.interfaces.length || 0} interfaces`);
    for (const iface of this.device.configuration?.interfaces || []) {
      this.logging.log(`Interface ${iface.interfaceNumber}: ${iface.alternates.length} alternates`);
      for (const alt of iface.alternates) {
        this.logging.log(`  Alternate ${alt.alternateSetting}: class=${alt.interfaceClass}, endpoints=${alt.endpoints.length}`);
        for (const ep of alt.endpoints) {
          this.logging.log(`    Endpoint ${ep.endpointNumber} (0x${ep.endpointNumber.toString(16)}), direction=${ep.direction}, type=${ep.type}`);
        }
      }
    }

    // Claim J-Link interface for flashing commands
    try {
      await this.device.claimInterface(JLINK_INTERFACE.JLINK);
      this.logging.log("J-Link interface claimed");

      // Detect J-Link endpoint numbers (vary by hardware version)
      const jlinkIface = this.device.configuration?.interfaces.find(
        (iface) => iface.interfaceNumber === JLINK_INTERFACE.JLINK
      );
      if (jlinkIface) {
        for (const endpoint of jlinkIface.alternate.endpoints) {
          if (endpoint.direction === "in") {
            this.jlinkInEndpoint = endpoint.endpointNumber;
            this.logging.log(`Detected J-Link IN endpoint: ${this.jlinkInEndpoint}`);
          } else if (endpoint.direction === "out") {
            this.jlinkOutEndpoint = endpoint.endpointNumber;
            this.logging.log(`Detected J-Link OUT endpoint: ${this.jlinkOutEndpoint}`);
          }
        }
      }
    } catch (e) {
      this.logging.log(`Error claiming J-Link interface: ${e}`);
    }

    // Claim CDC data interface (interface 1) to detach kernel driver and access serial endpoints
    // The control interface (0) can remain with the kernel, we only need the data interface
    try {
      await this.device.claimInterface(JLINK_INTERFACE.CDC_DATA);
      this.logging.log("CDC data interface claimed for serial communication");

      // Detect CDC endpoint numbers
      const cdcIface = this.device.configuration?.interfaces.find(
        (iface) => iface.interfaceNumber === JLINK_INTERFACE.CDC_DATA
      );
      if (cdcIface) {
        for (const endpoint of cdcIface.alternate.endpoints) {
          if (endpoint.direction === "in") {
            this.cdcInEndpoint = endpoint.endpointNumber;
            this.logging.log(`Detected CDC IN endpoint: ${this.cdcInEndpoint}`);
          } else if (endpoint.direction === "out") {
            this.cdcOutEndpoint = endpoint.endpointNumber;
            this.logging.log(`Detected CDC OUT endpoint: ${this.cdcOutEndpoint}`);
          }
        }
      }
    } catch (e) {
      this.logging.log(`Warning: Could not claim CDC data interface: ${e}`);
    }

    this.logging.event({
      type: "WebUSB-info",
      message: "connected",
    });

    const serialInfo = this.boardSerialInfo;
    this.logging.log(`Detected J-Link device: ${serialInfo.id}`);

    if (
      !this.loggedBoardSerialInfo ||
      !this.loggedBoardSerialInfo.eq(this.boardSerialInfo)
    ) {
      this.loggedBoardSerialInfo = this.boardSerialInfo;
      this.logging.event({
        type: "WebUSB-info",
        message: "board-id/" + this.boardSerialInfo.id,
      });
      this.logging.event({
        type: "WebUSB-info",
        message:
          "board-family-hic/" +
          this.boardSerialInfo.familyId +
          this.boardSerialInfo.hic,
      });
    }

    // TODO: Query device information via J-Link protocol
    // For now, use default values for Calliope mini v2 (nRF52833)
    this._deviceId = 0; // Will be populated when J-Link protocol is implemented
    this._pageSize = 4096;
    this._numPages = 128;
  }

  /**
   * Disconnect from the device.
   */
  async disconnectAsync(): Promise<void> {
    if (this.serialReading) {
      this.serialReading = false;
      await this.serialReadLoop;
    }

    if (this.device.opened) {
      // Release claimed interfaces
      try {
        await this.device.releaseInterface(JLINK_INTERFACE.CDC_DATA);
      } catch (e) {
        // Ignore errors if interface wasn't claimed
      }
      try {
        await this.device.releaseInterface(JLINK_INTERFACE.JLINK);
      } catch (e) {
        this.logging.log("Error releasing J-Link interface");
      }

      await this.device.close();
    }
  }

  /**
   * Start reading serial data via CDC interface.
   * 
   * LIMITATION: On Linux, the kernel's cdc_acm driver automatically claims CDC interfaces,
   * preventing WebUSB from accessing them. Serial communication works on Windows/macOS but
   * not on Linux. On Linux, use /dev/ttyACM0 via Web Serial API or native code instead.
   * 
   * Note: CDC interfaces are typically claimed by the OS kernel, but we can still
   * use the endpoints via controlTransferOut and transferIn/Out.
   */
  async startSerial(listener: (data: string) => void): Promise<void> {
    this.serialListener = listener;
    this.logging.log("Starting CDC serial communication on unclaimed interface");

    // On Linux, the kernel's cdc_acm driver owns interface 1, preventing us from claiming it.
    // However, let's try to read from the CDC endpoints anyway - some browsers may allow this.
    
    // Start the serial read loop using CDC endpoints
    this.serialReading = true;
    this.serialReadLoop = this.serialReadLoopFunction();
    this.logging.log("Serial read loop started");
  }

  /**
   * Stop reading serial data.
   */
  stopSerial(listener: (data: string) => void): void {
    if (this.serialListener === listener) {
      this.serialReading = false;
      this.serialListener = undefined;
    }
  }

  /**
   * Continuous read loop for serial data.
   */
  private async serialReadLoopFunction(): Promise<void> {
    this.logging.log("Serial read loop function started");
    let readCount = 0;
    while (this.serialReading) {
      try {
        readCount++;
        if (readCount <= 3) {
          this.logging.log(`Serial read attempt ${readCount} on CDC endpoint ${this.cdcInEndpoint}`);
        }
        const result = await this.device.transferIn(
          this.cdcInEndpoint,
          64, // Read up to 64 bytes
        );

        if (readCount <= 3) {
          this.logging.log(`Transfer result status: ${result.status}, bytes: ${result.data?.byteLength || 0}`);
        }

        if (result.data && result.data.byteLength > 0) {
          const text = new TextDecoder().decode(result.data);
          this.logging.log(`Received ${result.data.byteLength} bytes: ${text}`);
          if (this.serialListener) {
            this.serialListener(text);
          }
        }
      } catch (e) {
        if (this.serialReading) {
          this.logging.log(`Serial read error: ${e}`);
          // Wait a bit before retrying
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    }
    this.logging.log("Serial read loop ended");
  }

  /**
   * Write data to serial via CDC interface.
   */
  async serialWrite(data: string): Promise<void> {
    const bytes = new TextEncoder().encode(data);
    await this.device.transferOut(this.cdcOutEndpoint, bytes);
  }

  /**
   * Software reset via J-Link protocol.
   */
  async softwareReset(): Promise<void> {
    this.logging.log("J-Link software reset requested");
    try {
      await this.protocol.resetTarget(true);
      this.logging.log("Reset complete");
    } catch (error) {
      this.logging.log(`Reset error: ${error}`);
      throw new Error("J-Link reset not yet implemented - protocol incomplete");
    }
  }

  /**
   * Flash hex data to the device using J-Link MSD protocol.
   * 
   * This uses the J-Link Mass Storage Device (MSD) flashing protocol,
   * which sends the Intel HEX file data directly to the probe.
   * The J-Link probe handles parsing, erasing, programming, and verification internally.
   * 
   * @param hexData The Intel HEX file data to flash
   * @param progressCallback Optional callback for progress updates (0-1)
   */
  async flashHex(
    hexData: string,
    progressCallback?: (progress: number) => void,
  ): Promise<void> {
    this.logging.log("J-Link flash requested");
    
    try {
      if (progressCallback) progressCallback(0.0);
      
      // Connect to J-Link probe and check capabilities
      this.logging.log("Connecting to J-Link probe");
      await this.protocol.connect();
      
      if (progressCallback) progressCallback(0.1);
      
      // Program flash using MSD protocol
      // The hex data is sent as-is; the J-Link probe handles everything
      this.logging.log(`Programming ${hexData.length} bytes of hex data`);
      await this.protocol.programFlash(hexData, (progress) => {
        // Map protocol progress (0-1) to overall progress (0.1-1.0)
        if (progressCallback) {
          progressCallback(0.1 + progress * 0.9);
        }
      });
      
      this.logging.log("Flash complete");
      if (progressCallback) progressCallback(1.0);
    } catch (error) {
      this.logging.log(`Flash error: ${error}`);
      throw error;
    }
  }

  /**
   * Send a J-Link command and optionally receive response.
   * 
   * @param command The command bytes to send
   * @param expectResponse Whether to wait for and read a response (default: true)
   * @returns The response bytes (empty if expectResponse is false)
   */
  private async sendJLinkCommand(command: Uint8Array, expectResponse: boolean = true): Promise<Uint8Array> {
    // Send command to J-Link OUT endpoint
    await this.device.transferOut(this.jlinkOutEndpoint, command as BufferSource);

    if (!expectResponse) {
      return new Uint8Array(0);
    }

    // Read response from J-Link IN endpoint
    const result = await this.device.transferIn(this.jlinkInEndpoint, 64);

    if (!result.data) {
      throw new Error("No response from J-Link");
    }

    return new Uint8Array(result.data.buffer);
  }
}

/**
 * (c) 2025, Micro:bit Educational Foundation and contributors
 *
 * SPDX-License-Identifier: MIT
 */

import { Logging } from "./logging.js";
import { BoardSerialInfo } from "./board-serial-info.js";

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

const JLINK_ENDPOINTS = {
  // CDC Serial endpoints (Interface 1)
  CDC_IN: 0x81,  // EP 1 IN - serial data from device
  CDC_OUT: 0x01, // EP 1 OUT - serial data to device

  // J-Link command endpoints (Interface 2)
  JLINK_IN: 0x83,  // EP 3 IN - J-Link responses
  JLINK_OUT: 0x02, // EP 2 OUT - J-Link commands
} as const;

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

  // Device info (will be populated on connection)
  _pageSize: number | undefined;
  _numPages: number | undefined;
  _deviceId: number | undefined;

  constructor(
    public device: USBDevice,
    private logging: Logging,
  ) {}

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
    } catch (e) {
      this.logging.log(`Error claiming J-Link interface: ${e}`);
    }

    // Claim CDC data interface (interface 1) to detach kernel driver and access serial endpoints
    // The control interface (0) can remain with the kernel, we only need the data interface
    try {
      await this.device.claimInterface(JLINK_INTERFACE.CDC_DATA);
      this.logging.log("CDC data interface claimed for serial communication");
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
          this.logging.log(`Serial read attempt ${readCount} on CDC endpoint 0x${JLINK_ENDPOINTS.CDC_IN.toString(16)}`);
        }
        const result = await this.device.transferIn(
          JLINK_ENDPOINTS.CDC_IN, // Use CDC endpoint (0x81)
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
    await this.device.transferOut(JLINK_ENDPOINTS.CDC_OUT, bytes);
  }

  /**
   * Software reset via J-Link protocol.
   * TODO: Implement using J-Link commands.
   */
  async softwareReset(): Promise<void> {
    this.logging.log("J-Link software reset requested");
    // TODO: Send J-Link reset command via JLINK_OUT endpoint
    throw new Error("J-Link reset not yet implemented");
  }

  /**
   * Flash hex data to the device.
   * TODO: Implement using J-Link protocol.
   * 
   * @param hexData The hex file data to flash
   * @param progressCallback Optional callback for progress updates (0-1)
   */
  async flashHex(
    hexData: string,
    progressCallback?: (progress: number) => void,
  ): Promise<void> {
    this.logging.log("J-Link flash requested");
    // TODO: Implement J-Link flashing protocol
    // This will use sendJLinkCommand() to communicate with the device
    // For reference, the method is available but not yet implemented
    void this.sendJLinkCommand;
    throw new Error("J-Link flashing not yet implemented");
  }

  /**
   * Send a J-Link command and receive response.
   * TODO: Implement J-Link protocol.
   * 
   * @param command The command bytes to send
   * @returns The response bytes
   */
  private async sendJLinkCommand(command: Uint8Array): Promise<Uint8Array> {
    // Send command to JLINK_OUT endpoint
    await this.device.transferOut(JLINK_ENDPOINTS.JLINK_OUT, command as BufferSource);

    // Read response from JLINK_IN endpoint
    const result = await this.device.transferIn(JLINK_ENDPOINTS.JLINK_IN, 64);

    if (!result.data) {
      throw new Error("No response from J-Link");
    }

    return new Uint8Array(result.data.buffer);
  }
}

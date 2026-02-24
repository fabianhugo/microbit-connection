/**
 * (c) 2025, Micro:bit Educational Foundation and contributors
 *
 * SPDX-License-Identifier: MIT
 */

/**
 * J-Link Protocol Implementation for WebUSB
 * 
 * This module implements the SEGGER J-Link USB protocol for flashing.
 * 
 * Protocol details discovered from SEGGER's WebUSB demo:
 * https://www.segger.com/jlink_webusb_update_target_firmware.html
 * 
 * The J-Link MSD (Mass Storage Device) flashing protocol uses these commands:
 * - EMU_CMD_GET_CAPS_EX (0xED): Get extended capabilities
 * - EMU_CMD_GET_PROBE_INFO (0x1C): Get probe info / perform operations
 *   - Subcommand 0: Get probe capabilities
 *   - Subcommand 5: Write MSD image chunk
 *   - Subcommand 6: Finalize MSD image write
 * 
 * Target Device: Calliope mini v2 (nRF52833)
 * - ARM Cortex-M4
 * - 512KB Flash
 * - 128KB RAM
 */

/**
 * J-Link command identifiers (discovered from USB packet capture).
 */
export enum JLinkCommand {
  // Extended capabilities
  EMU_CMD_GET_CAPS_EX = 0xED, // 237
  
  // Probe info and operations
  EMU_CMD_GET_PROBE_INFO = 0x1C, // 28
}

/**
 * J-Link GET_PROBE_INFO subcommands
 */
export enum JLinkProbeInfoSubCommand {
  GET_CAPS = 0, // Get probe capabilities
  WRITE_MSD_IMG_CHUNK = 5, // Write image chunk (for MSD flashing)
  WRITE_MSD_IMG_END = 6, // Finalize image write
}

/**
 * Create GET_CAPS_EX command packet.
 */
function createGetCapsExCommand(): Uint8Array {
  return new Uint8Array([JLinkCommand.EMU_CMD_GET_CAPS_EX]);
}

/**
 * Create GET_PROBE_INFO command packet.
 * @param subCommand Subcommand (0=get caps, 5=write chunk, 6=finalize)
 * @param data Optional data payload for write operations
 */
function createGetProbeInfoCommand(
  subCommand: JLinkProbeInfoSubCommand,
  data?: Uint8Array
): Uint8Array {
  if (data) {
    // Format: [0x1C, subCmd, size_lo, size_hi, 0x00, 0x00, ...data...]
    const packet = new Uint8Array(6 + data.length);
    packet[0] = JLinkCommand.EMU_CMD_GET_PROBE_INFO;
    packet[1] = subCommand;
    packet[2] = data.length & 0xFF; // size low byte
    packet[3] = (data.length >> 8) & 0xFF; // size high byte
    packet[4] = 0x00; // reserved
    packet[5] = 0x00; // reserved
    packet.set(data, 6);
    return packet;
  } else {
    // Simple command without data
    return new Uint8Array([JLinkCommand.EMU_CMD_GET_PROBE_INFO, subCommand]);
  }
}

/**
 * J-Link protocol implementation class.
 * 
 * This class encapsulates the J-Link MSD flashing protocol.
 */
export class JLinkProtocol {
  private static readonly CHUNK_SIZE = 4096; // 4KB chunks

  constructor(
    private sendCommand: (cmd: Uint8Array, expectResponse?: boolean) => Promise<Uint8Array>,
  ) {}

  /**
   * Initialize connection to the J-Link probe.
   * 
   * Sends GET_CAPS_EX and GET_PROBE_INFO(0) to query capabilities.
   */
  async connect(): Promise<void> {
    // Get extended capabilities
    const capsCmd = createGetCapsExCommand();
    const capsResponse = await this.sendCommand(capsCmd);
    
    if (capsResponse.byteLength !== 32) {
      throw new Error(`Expected 32 bytes from GET_CAPS_EX, got ${capsResponse.byteLength}`);
    }

    // Get probe capabilities
    const probeCapsCmd = createGetProbeInfoCommand(JLinkProbeInfoSubCommand.GET_CAPS);
    const probeCapsResponse = await this.sendCommand(probeCapsCmd);
    
    if (probeCapsResponse.byteLength !== 4) {
      throw new Error(`Expected 4 bytes from GET_PROBE_INFO(0), got ${probeCapsResponse.byteLength}`);
    }

    // Parse capabilities (little-endian)
    const caps = probeCapsResponse[0] | 
                 (probeCapsResponse[1] << 8) | 
                 (probeCapsResponse[2] << 16) | 
                 (probeCapsResponse[3] << 24);
    
    // Check if MSD flashing is supported (bit 0)
    if ((caps & 0x01) === 0) {
      throw new Error("J-Link probe does not support MSD flashing");
    }
  }

  /**
   * Initialize target device for flashing.
   * 
   * For MSD-based flashing, the J-Link probe handles target initialization internally.
   * This method is kept for API compatibility but does nothing.
   */
  async initFlash(_targetDevice: string = "nRF52833"): Promise<void> {
    // Not needed for MSD flashing - J-Link handles this internally
  }

  /**
   * Erase flash sectors.
   * 
   * For MSD-based flashing, erase is handled automatically during programming.
   * This method is kept for API compatibility but does nothing.
   */
  async eraseFlash(_startAddress: number, _length: number): Promise<void> {
    // Not needed for MSD flashing - handled automatically
  }

  /**
   * Program flash memory using MSD protocol.
   * 
   * This sends the Intel HEX file data as-is (ASCII text) in 4KB chunks.
   * The J-Link probe parses and flashes it to the target.
   * 
   * @param hexData Intel HEX format data as string or binary
   * @param progressCallback Optional progress callback (0-1)
   */
  async programFlash(
    hexData: string | Uint8Array,
    progressCallback?: (progress: number) => void,
  ): Promise<void> {
    // Convert string to binary if needed
    const data = typeof hexData === 'string' 
      ? new TextEncoder().encode(hexData)
      : hexData;

    const totalChunks = Math.ceil(data.length / JLinkProtocol.CHUNK_SIZE);
    
    for (let i = 0; i < totalChunks; i++) {
      const start = i * JLinkProtocol.CHUNK_SIZE;
      const end = Math.min(start + JLinkProtocol.CHUNK_SIZE, data.length);
      const chunk = data.slice(start, end);

      // Send chunk (no response expected for chunk writes)
      const chunkCmd = createGetProbeInfoCommand(
        JLinkProbeInfoSubCommand.WRITE_MSD_IMG_CHUNK,
        chunk
      );
      await this.sendCommand(chunkCmd, false); // false = don't wait for response

      // Report progress
      if (progressCallback) {
        progressCallback((i + 1) / totalChunks);
      }
    }

    // Finalize write
    const finalizeCmd = createGetProbeInfoCommand(JLinkProbeInfoSubCommand.WRITE_MSD_IMG_END);
    const finalizeResponse = await this.sendCommand(finalizeCmd);

    if (finalizeResponse.byteLength !== 4) {
      throw new Error(`Expected 4 bytes from finalize, got ${finalizeResponse.byteLength}`);
    }

    // Check result (0 = success)
    const result = finalizeResponse[0] | 
                   (finalizeResponse[1] << 8) | 
                   (finalizeResponse[2] << 16) | 
                   (finalizeResponse[3] << 24);

    if (result !== 0) {
      // Common error codes (reverse-engineered):
      // 0x55 (85): Invalid hex file or unsupported format
      // 0xFF (-1): Communication error
      const errorMsg = result === 0x55 
        ? `Flashing failed: Invalid or incompatible hex file (error code: ${result}). Ensure the hex file is for nRF52833/Calliope mini V2.`
        : `Flashing failed with error code: ${result} (0x${result.toString(16)})`;
      throw new Error(errorMsg);
    }
  }

  /**
   * Verify flash memory.
   * 
   * The MSD protocol doesn't provide verification - the J-Link handles this internally.
   * This method is kept for API compatibility.
   */
  async verifyFlash(_address: number, _expectedData: Uint8Array): Promise<boolean> {
    // Verification is handled by J-Link internally during MSD flashing
    return true;
  }

  /**
   * Reset the target device.
   * 
   * The J-Link automatically resets the target after successful flashing.
   * This method is kept for API compatibility but does nothing.
   */
  async resetTarget(_runAfterReset: boolean = true): Promise<void> {
    // Target is automatically reset after flashing
  }

  /**
   * Disconnect from target and J-Link probe.
   * 
   * No special disconnect sequence needed for MSD flashing.
   */
  async disconnect(): Promise<void> {
    // No special disconnect needed
  }
}

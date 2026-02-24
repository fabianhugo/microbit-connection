/**
 * (c) 2021, Micro:bit Educational Foundation and contributors
 *
 * SPDX-License-Identifier: MIT
 */
import { BoardId } from "./board-id.js";
import { isJLinkDevice } from "./usb-interface-type.js";

export class BoardSerialInfo {
  constructor(
    public id: BoardId,
    public familyId: string,
    public hic: string,
  ) {}

  /**
   * Parse board information from a USB device.
   * 
   * DAPLink devices use a 48-character serial with embedded board ID, family, and HIC.
   * J-Link devices use a shorter serial; board is identified by USB VID/PID.
   */
  static parse(device: USBDevice, log: (msg: string) => void) {
    const serial = device.serialNumber;
    if (!serial) {
      throw new Error("Could not detected ID from connected board.");
    }

    // Check if this is a J-Link device (Calliope mini v2)
    // Handle cases where VID/PID might not be available (e.g., test mocks)
    try {
      if (isJLinkDevice(device)) {
        // J-Link devices have short serials and are identified by VID/PID
        log(`Detected J-Link device with serial: ${serial}`);
        return new BoardSerialInfo(
          BoardId.forCalliopeV2(),
          "JLINK", // Use JLINK as family identifier
          "SEGGER", // Use SEGGER as HIC identifier
        );
      }
    } catch (e) {
      // If we can't determine interface type (e.g., missing VID/PID in tests),
      // assume DAPLink for backward compatibility
      log(`Could not determine interface type, assuming DAPLink: ${e}`);
    }

    // DAPLink devices have 48-character serials
    if (serial.length !== 48) {
      log(`USB serial number unexpected length: ${serial.length}`);
    }
    const id = serial.substring(0, 4);
    const familyId = serial.substring(4, 8);
    const hic = serial.slice(-8);
    return new BoardSerialInfo(BoardId.parse(id), familyId, hic);
  }

  eq(other: BoardSerialInfo) {
    return (
      other.id === this.id &&
      other.familyId === this.familyId &&
      other.hic === this.hic
    );
  }
}

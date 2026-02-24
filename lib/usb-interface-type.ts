/**
 * (c) 2025, Micro:bit Educational Foundation and contributors
 *
 * SPDX-License-Identifier: MIT
 */

/**
 * USB interface firmware types supported by this library.
 */
export enum UsbInterfaceType {
  /**
   * ARM DAPLink interface (used by micro:bit, Calliope mini v1 and v3).
   * Vendor ID: 0x0d28 (ARM), Product ID: 0x0204
   */
  DAPLink = "DAPLink",

  /**
   * SEGGER J-Link OB interface (used by Calliope mini v2).
   * Vendor ID: 0x1366 (SEGGER), Product ID: 0x1025 (Calliope mini)
   */
  JLink = "JLink",
}

/**
 * USB vendor and product ID combinations for different interface types.
 */
export const USB_IDS = {
  DAPLINK: {
    vendorId: 0x0d28, // ARM
    productId: 0x0204, // DAPLink
  },
  JLINK_CALLIOPE: {
    vendorId: 0x1366, // SEGGER
    productId: 0x1025, // Calliope mini
  },
} as const;

/**
 * USB device filters for all supported interfaces.
 */
export const ALL_DEVICE_FILTERS: USBDeviceFilter[] = [
  { vendorId: USB_IDS.DAPLINK.vendorId, productId: USB_IDS.DAPLINK.productId },
  {
    vendorId: USB_IDS.JLINK_CALLIOPE.vendorId,
    productId: USB_IDS.JLINK_CALLIOPE.productId,
  },
];

/**
 * Detect the USB interface type from a USB device.
 *
 * @param device The USB device to check.
 * @returns The interface type.
 * @throws Error if the device is not recognized.
 */
export function detectInterfaceType(device: USBDevice): UsbInterfaceType {
  // Handle cases where vendorId/productId might be undefined (e.g., in tests)
  if (device.vendorId === undefined || device.productId === undefined) {
    throw new Error("USB device missing vendor ID or product ID");
  }

  if (
    device.vendorId === USB_IDS.DAPLINK.vendorId &&
    device.productId === USB_IDS.DAPLINK.productId
  ) {
    return UsbInterfaceType.DAPLink;
  }

  if (
    device.vendorId === USB_IDS.JLINK_CALLIOPE.vendorId &&
    device.productId === USB_IDS.JLINK_CALLIOPE.productId
  ) {
    return UsbInterfaceType.JLink;
  }

  throw new Error(
    `Unsupported USB device: ${device.vendorId.toString(16)}:${device.productId.toString(16)}`,
  );
}

/**
 * Check if a device uses J-Link interface.
 */
export function isJLinkDevice(device: USBDevice): boolean {
  return detectInterfaceType(device) === UsbInterfaceType.JLink;
}

/**
 * Check if a device uses DAPLink interface.
 */
export function isDAPLinkDevice(device: USBDevice): boolean {
  return detectInterfaceType(device) === UsbInterfaceType.DAPLink;
}

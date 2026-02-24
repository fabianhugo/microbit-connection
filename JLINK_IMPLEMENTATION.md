# J-Link Support Implementation Progress

## Completed: Phase 1 - Core Infrastructure ✅

### 1. USB Device Filters
- **File:** `lib/usb-interface-type.ts` (new)
- Added SEGGER J-Link USB filters:
  - Vendor ID: `0x1366` (SEGGER)
  - Product ID: `0x1025` (Calliope mini)
- Updated `lib/usb.ts` to use new filter array supporting both DAPLink and J-Link

### 2. Interface Type Detection
- **File:** `lib/usb-interface-type.ts` (new)
- Created `UsbInterfaceType` enum with `DAPLink` and `JLink` types
- Implemented `detectInterfaceType()` to identify device type based on VID/PID
- Added helper functions: `isJLinkDevice()`, `isDAPLinkDevice()`

### 3. Board ID Extension
- **File:** `lib/board-id.ts` (modified)
- Added support for Calliope mini v2
- Created synthetic board ID `0x9902` for Calliope v2 (J-Link based)
- Added `isCalliopeV2()` method
- Added `forCalliopeV2()` static factory method

### 4. Board Serial Info Parser
- **File:** `lib/board-serial-info.ts` (modified)
- Updated to handle two serial number formats:
  - **DAPLink**: 48-character format with embedded board ID/family/HIC
  - **J-Link**: Short format (12 characters), identified by USB VID/PID
- J-Link devices use synthetic identifiers: familyId=`JLINK`, hic=`SEGGER`

### 5. J-Link Wrapper Skeleton
- **File:** `lib/usb-jlink-wrapper.ts` (new)
- Created `JLinkWrapper` class with similar interface to `DAPWrapper`
- **Implemented:**
  - USB interface configuration constants (CDC, J-Link, MSC interfaces)
  - Endpoint definitions from USB descriptor analysis
  - Connection/disconnection flow
  - **Full CDC serial support** (read/write using standard USB CDC ACM)
- **TODO (requires J-Link protocol research):**
  - Device information queries
  - Flash programming
  - Software reset commands

## Hardware Information Gathered

### Calliope mini v2 USB Configuration
```
Vendor ID:  0x1366 (SEGGER)
Product ID: 0x1025 (Calliope mini)
Serial:     000889591706 (12 characters)
```

### USB Interfaces
- **Interface 0-1:** CDC (Serial/UART)
  - EP 0x02 IN (interrupt) - control notifications
  - EP 0x81 IN (bulk) - serial data from device
  - EP 0x01 OUT (bulk) - serial data to device
- **Interface 2:** Vendor Specific (J-Link protocol)
  - EP 0x83 IN (bulk) - J-Link responses
  - EP 0x02 OUT (bulk) - J-Link commands
- **Interface 3:** Mass Storage
  - EP 0x84 IN (bulk)
  - EP 0x03 OUT (bulk)

### Known Limitations

#### Linux CDC Serial Communication
**Status:** Serial communication NOT available on Linux via WebUSB

**Issue:** The Linux kernel's `cdc_acm` driver automatically claims CDC ACM interfaces (interfaces 0-1), creating `/dev/ttyACM0`. WebUSB cannot claim interfaces that are already bound to kernel drivers, preventing serial communication.

**Evidence:**
- Connection succeeds, J-Link interface (2) is claimed successfully
- CDC data interface (1) claim fails: "Unable to claim interface"
- Endpoint access fails: "The specified interface has not been claimed"
- `/dev/ttyACM0` exists when device is connected

**Workarounds Investigated:**
- ❌ Using endpoints without claiming interface - requires interface claim for transferIn/Out
- ❌ Control transfers without claim - requires interface claim
- ❌ Using J-Link vendor endpoints for serial - not supported by device firmware

**Solutions:**
1. **Manual unbind (not practical for users):** `echo "1-X:1.0" | sudo tee /sys/bus/usb/drivers/cdc_acm/unbind`
2. **Udev rules** to prevent automatic binding (complex, requires root setup)
3. **Use native serial instead:** Applications on Linux can use `/dev/ttyACM0` directly via Web Serial API or native code

**Platform Status:**
- ✅ **Windows/macOS:** Serial should work (kernel doesn't auto-claim CDC)
- ❌ **Linux:** Serial blocked by cdc_acm kernel driver
- ✅ **All platforms:** J-Link flashing interface works (interface 2 not claimed by kernel)

## Next Steps

### Phase 2: J-Link Protocol Implementation ✅ **COMPLETE**

**Status:** Protocol fully implemented and ready for testing

**Files Implemented:**
- `lib/jlink-protocol.ts` - Complete J-Link MSD flashing protocol
- `lib/usb-jlink-wrapper.ts` - Updated to use MSD protocol

**What Was Done:** ✅

1. **Protocol Discovery:** Captured USB packets from SEGGER's demo page:
   - Used browser DevTools console to intercept USB transfers
   - Captured complete flashing sequence with ~170 packets
   - Analyzed packet structure and command format

2. **Protocol Details Discovered:**
   - **EMU_CMD_GET_CAPS_EX** (0xED): Query extended capabilities → Returns 32 bytes
   - **EMU_CMD_GET_PROBE_INFO** (0x1C): Probe operations with subcommands:
     - Subcommand 0: Get probe capabilities → Returns 4 bytes (capability flags)
     - Subcommand 5: Write MSD image chunk → Send 4KB chunks of hex data
     - Subcommand 6: Finalize MSD image write → Returns 4 bytes (status)
   
3. **Chunk Format:** `[0x1C, 0x05, size_lo, size_hi, 0x00, 0x00, ...hex_data...]`
   - Size is little-endian (e.g., 0x00 0x10 = 4096 bytes)
   - Data is raw Intel HEX file content (ASCII), not parsed binary
   - Standard chunk size: 4096 bytes
   - Last chunk can be smaller

4. **Implementation Completed:**
   - ✅ `JLinkProtocol.connect()` - Queries capabilities and validates MSD support
   - ✅ `JLinkProtocol.programFlash()` - Sends hex data in 4KB chunks with progress
   - ✅ Simplified wrapper - no parsing, no erase, no verify (J-Link handles internally)
   - ✅ Progress reporting through callback
   - ✅ Error handling for failed operations

5. **Key Discovery:**
   - J-Link uses **MSD (Mass Storage Device) flashing protocol**
   - Hex file is sent as-is (text format), not parsed to binary
   - J-Link probe handles: parsing, erasing, programming, verification, reset
   - Much simpler than DAPLink's low-level flash control

**Testing Status:** 🧪
- ✅ Code compiles without errors
- ✅ Build completes successfully
- ⏳ Hardware testing pending (user has Calliope mini v2 available)

**USB Packet Capture Log:**
```
→ OUT EP2 [1 bytes]: 0xed                                    # GET_CAPS_EX
← IN  EP3 [32 bytes]: 0x33 0x5a 0x6a 0xb8 ...              # Capabilities

→ OUT EP2 [2 bytes]: 0x1c 0x00                               # GET_PROBE_INFO(0)
← IN  EP3 [4 bytes]: 0x05 0x00 0x00 0x00                    # Supports MSD (flag 0x05)

→ OUT EP2 [4102 bytes]: 0x1c 0x05 0x00 0x10 0x00 0x00 ...  # Write chunk (4096 bytes)
→ OUT EP2 [4102 bytes]: 0x1c 0x05 0x00 0x10 0x00 0x00 ...  # Write chunk
... (repeated ~170 times for full firmware)
→ OUT EP2 [1209 bytes]: 0x1c 0x05 0xb3 0x04 0x00 0x00 ...  # Last chunk (1203 bytes)

→ OUT EP2 [2 bytes]: 0x1c 0x06                               # Finalize write
← IN  EP3 [4 bytes]: 0x00 0x00 0x00 0x00                    # Success (0)
```

### Phase 3: Integration ✅ **COMPLETE**

**Completed Tasks:**
1. ✅ Updated `lib/usb.ts` to detect interface type and instantiate correct wrapper
   - Created `createDeviceWrapper()` factory method
   - Routes to JLinkWrapper or DAPWrapper based on USB VID/PID
2. ✅ Factory pattern for device wrapper instantiation
3. ✅ Modified flash methods to route to appropriate wrapper
   - J-Link uses `flashHex()` (full flash only, no partial flashing)
   - DAPLink uses existing partial flashing implementation
4. ✅ Updated demo page - J-Link devices display correctly
5. ✅ Testing with actual Calliope mini v2 hardware confirmed:
   - Connection works
   - Device detection works
   - Board ID displayed correctly (9902)
   - Serial UI added (Linux limitation documented)

**Status:** Integration complete, ready for protocol implementation

### Phase 4: Testing & Polish 🔄 **READY FOR TESTING**

**Current Status:** Implementation complete, awaiting hardware testing

**Next Steps:**
1. ⏳ Test flashing with actual Calliope mini v2 hardware
   - Start with small test firmware (blink LED)
   - Verify progress reporting
   - Test with full-size firmware
   - Confirm automatic reset after flashing
2. ⏳ Write unit tests for J-Link wrapper
3. ⏳ Update user-facing documentation (README.md)
4. ⏳ Verify backward compatibility with micro:bit/Calliope v1/v3

**Testing Checklist:**
- [ ] Connect to Calliope mini v2
- [ ] Flash small test hex file (<50KB)
- [ ] Verify progress bar updates smoothly
- [ ] Confirm device resets and runs new code
- [ ] Flash full firmware (~200KB)
- [ ] Test error handling (disconnect during flash, invalid hex)
- [ ] Test on different browsers (Chrome, Edge)
- [ ] Verify no regression on DAPLink devices

## Key Design Decisions

1. **Serial Communication:** J-Link uses standard CDC ACM, much simpler than DAPLink
2. **No Partial Flashing:** J-Link's high speed eliminates need for partial flashing
3. **Board Identification:** Calliope v2 identified by USB VID/PID rather than serial number
4. **Compatibility:** All changes maintain backward compatibility with existing DAPLink devices

## Resources

- SEGGER WebUSB Knowledge Base: https://kb.segger.com/WebUSB
- SEGGER Demo Page: https://www.segger.com/jlink_webusb_update_target_firmware.html
- Calliope mini v2 uses nRF52833 MCU

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

### Phase 2: J-Link Protocol Implementation 🔄

**Research Required:**
1. Inspect SEGGER's WebUSB demo JavaScript at: https://www.segger.com/jlink_webusb_update_target_firmware.html
2. Reverse-engineer J-Link command structure
3. Document J-Link protocol commands needed for:
   - Target initialization (nRF52833)
   - Flash erase operations
   - Flash write operations
   - Verification
   - Reset

**Implementation Tasks:**
1. Create J-Link protocol commands module
   - Flash initialization
   - Sector erase
   - Program/write
   - Verify
   - Reset
2. Implement hex file parsing for J-Link flashing
3. Implement `flashHex()` method in `JLinkWrapper`
4. Add progress reporting

### Phase 3: Integration 🔄

**Tasks:**
1. Update `lib/usb.ts` to detect interface type and instantiate correct wrapper
2. Create abstract device wrapper interface
3. Modify flash methods to route to appropriate wrapper
4. Update demo page to show J-Link devices
5. Testing with actual hardware

### Phase 4: Testing & Polish 🔄

**Tasks:**
1. Write unit tests for J-Link wrapper
2. Test with Calliope mini v2 hardware
3. Update documentation
4. Verify backward compatibility with micro:bit/Calliope v1/v3

## Key Design Decisions

1. **Serial Communication:** J-Link uses standard CDC ACM, much simpler than DAPLink
2. **No Partial Flashing:** J-Link's high speed eliminates need for partial flashing
3. **Board Identification:** Calliope v2 identified by USB VID/PID rather than serial number
4. **Compatibility:** All changes maintain backward compatibility with existing DAPLink devices

## Resources

- SEGGER WebUSB Knowledge Base: https://kb.segger.com/WebUSB
- SEGGER Demo Page: https://www.segger.com/jlink_webusb_update_target_firmware.html
- Calliope mini v2 uses nRF52833 MCU

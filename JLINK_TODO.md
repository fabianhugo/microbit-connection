# J-Link Protocol Implementation - Next Steps

## Current Status

### ✅ What Works
- **Connection:** Calliope mini v2 connects successfully via WebUSB
- **Device Detection:** Correctly identified as J-Link device (board ID 9902)
- **Interface Claiming:** J-Link interface (2) claimed successfully
- **Integration:** Factory pattern routes J-Link devices to correct wrapper
- **Flash Workflow:** Complete flash sequence implemented (parse → connect → erase → program → verify → reset)
- **Structure:** Protocol class ready with method stubs for all operations
- **WebUSB Basics:** Confirmed our approach matches SEGGER's reference implementation (see [SEGGER_WEBUSB_ANALYSIS.md](SEGGER_WEBUSB_ANALYSIS.md))

### ❌ What's Missing
- **J-Link Protocol Commands:** Need actual command IDs and packet formats
- **Protocol Implementation:** All JLinkProtocol methods throw "not implemented" errors
- **Serial on Linux:** CDC interfaces claimed by kernel driver (documented limitation)

### 📚 What We Learned from SEGGER Demo Code

Found SEGGER's emUSB-Device WebUSB demo (`seggerbulk.js`). Key findings:
- ✅ Confirms our WebUSB connection approach is correct
- ✅ Shows how to find vendor-specific interface (class 0xFF) - we do this
- ✅ Demonstrates bulk transfer pattern - we have this
- ❌ **BUT:** That demo is for LED control, not J-Link flashing
- ❌ No help with actual J-Link flashing protocol commands

See [SEGGER_WEBUSB_ANALYSIS.md](SEGGER_WEBUSB_ANALYSIS.md) for detailed comparison.

## How to Complete Implementation

### Step 1: Reverse-Engineer Protocol from SEGGER Demo

1. **Open the demo page:**
   ```
   https://www.segger.com/jlink_webusb_update_target_firmware.html
   ```

2. **Enable USB packet capture:**
   - Chrome/Edge: DevTools → Network tab → Filter: "Other"
   - Or use browser extension: "WebUSB Logger" or similar
   - Or system-level: Wireshark with usbmon on Linux

3. **Capture a firmware update:**
   - Prepare a small test firmware (e.g., blink LED)
   - Click "Choose File" and select firmware
   - Start the update process
   - Observe all USB transferOut/transferIn calls

4. **Document the packet structure:**
   ```typescript
   // Example format to discover:
   interface JLinkPacket {
     header: {
       commandId: number;  // 1 byte
       length: number;     // 2 bytes? 4 bytes?
       // Any other header fields?
     };
     payload: Uint8Array;
     checksum?: number;    // If used
   }
   ```

5. **Look for these specific operations:**
   - Initial handshake/version query
   - Interface selection (SWD vs JTAG)
   - Speed configuration
   - Target connection
   - Flash erase command
   - Flash write command (what's the chunk size?)
   - Flash verify/read command
   - Reset command

### Step 2: Update `lib/jlink-protocol.ts`

Once you have the protocol information:

#### 2.1 Update Command IDs
```typescript
export enum JLinkCommand {
  // Replace placeholders with actual values discovered
  GET_VERSION = 0x01,     // Confirm or update
  CONNECT = 0xc8,         // Confirm or update
  // Add flash commands:
  FLASH_ERASE = 0x??,
  FLASH_WRITE = 0x??,
  FLASH_READ = 0x??,
  // etc.
}
```

#### 2.2 Implement Packet Creation
```typescript
export function createCommand(cmd: JLinkCommand, data?: Uint8Array): Uint8Array {
  // Replace placeholder with actual format
  // Example:
  const header = new Uint8Array([
    cmd,                              // Command byte
    (data?.length || 0) & 0xFF,      // Length low byte
    ((data?.length || 0) >> 8) & 0xFF, // Length high byte
  ]);
  // ... combine header + payload + checksum
}
```

#### 2.3 Implement Response Parsing
```typescript
export function parseResponse(response: Uint8Array): JLinkResponse {
  // Parse actual response format
  // Check for errors, extract data, etc.
  const success = response[0] === 0x00; // Example
  return {
    success,
    data: success ? response.slice(1) : undefined,
    error: success ? undefined : `Error code: ${response[0]}`,
  };
}
```

#### 2.4 Implement Protocol Methods

Fill in each method in `JLinkProtocol` class:

```typescript
async connect(): Promise<void> {
  // 1. Send version query
  const versionCmd = createCommand(JLinkCommand.GET_VERSION);
  const versionResp = await this.sendCommand(versionCmd);
  // ... parse and validate
  
  // 2. Select SWD interface  
  const selectCmd = createCommand(JLinkCommand.SELECT_INTERFACE, new Uint8Array([0x01]));
  await this.sendCommand(selectCmd);
  
  // 3. Set speed (e.g., 4MHz)
  // ...
  
  // 4. Connect to target
  // ...
}

async initFlash(targetDevice: string = "nRF52833"): Promise<void> {
  // For nRF52833, may need to:
  // - Halt CPU
  // - Write to NVMC registers to enable flash write
  // - Memory addresses from nRF52833 datasheet:
  //   NVMC.CONFIG = 0x4001E504 (write 0x01 to enable write)
}

async eraseFlash(startAddress: number, length: number): Promise<void> {
  // Send erase command with address range
  // Or mass erase if supported
}

async programFlash(
  address: number,
  data: Uint8Array,
  progressCallback?: (progress: number) => void,
): Promise<void> {
  // Program in chunks (determine optimal size, likely 256 bytes or page size)
  const chunkSize = 256; // Adjust based on protocol
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    const chunk = data.slice(offset, offset + chunkSize);
    const cmd = createCommand(JLinkCommand.FLASH_WRITE, /* address + offset + chunk */);
    await this.sendCommand(cmd);
    if (progressCallback) {
      progressCallback(offset / data.length);
    }
  }
}

async verifyFlash(address: number, expectedData: Uint8Array): Promise<boolean> {
  // Read back flash content
  const readCmd = createCommand(JLinkCommand.FLASH_READ, /* address + length */);
  const response = await this.sendCommand(readCmd);
  const actualData = parseResponse(response).data;
  // Compare byte by byte
  return /* comparison result */;
}

async resetTarget(runAfterReset: boolean = true): Promise<void> {
  // Send reset command with parameter
  const resetCmd = createCommand(JLinkCommand.RESET, new Uint8Array([runAfterReset ? 1 : 0]));
  await this.sendCommand(resetCmd);
}
```

### Step 3: Test Incrementally

1. **Test connection first:**
   ```typescript
   // In browser console after connecting:
   const wrapper = connection.connection; // JLinkWrapper instance
   await wrapper.protocol.connect();
   ```

2. **Test each operation independently:**
   - Connect → Success?
   - Init flash → Success?
   - Erase small region → Success?
   - Program small amount → Can read back?

3. **Test full flash with minimal firmware:**
   - Create smallest possible valid nRF52 firmware (just vector table + reset handler)
   - Flash it
   - Verify device boots

4. **Test with real firmware:**
   - Flash actual Calliope mini v2 firmware
   - Verify all features work

### Step 4: Document and Clean Up

1. Update `JLINK_IMPLEMENTATION.md` with:
   - Protocol command details discovered
   - Packet format documentation
   - Any quirks or special requirements

2. Add error handling and retries

3. Optimize chunk sizes and timing

4. Add comprehensive logging (removable in production)

## Alternative Resources

If reverse-engineering is difficult:

1. **Check OpenOCD source:**
   - `src/jtag/drivers/jlink.c` has J-Link protocol implementation
   - May not be identical to WebUSB version but possibly similar

2. **Check pyOCD:**
   - Python implementation might be easier to read
   - https://github.com/pyocd/pyOCD

3. **SEGGER SDK:**
   - Contact SEGGER for official SDK or documentation
   - May require commercial licensing

4. **Community:**
   - Ask on SEGGER forums
   - Check GitHub for J-Link WebUSB projects

## Testing Firmware

Minimal nRF52833 test firmware (HEX format):
```
:020000040000FA
:10000000000100200D000008000000000000000000E6
:10001000000000000000000000000000000000000E0
:0400000500000000F7
:00000001FF
```
This sets stack pointer and reset vector only.

For blinking LED, you'll need:
- GPIO configuration for LED pin
- Simple delay loop
- Infinite loop toggling LED

## Expected Timeline

- Protocol reverse-engineering: 4-8 hours (depending on complexity)
- Implementation: 8-16 hours
- Testing and debugging: 4-8 hours
- Total: ~2-4 days of focused work

## Questions?

If you encounter issues:
1. Check browser console for detailed error messages
2. Enable verbose logging in `lib/logging.ts`
3. Compare with working DAPLink implementation for patterns
4. Test with multiple firmware sizes to find edge cases

Good luck! 🚀

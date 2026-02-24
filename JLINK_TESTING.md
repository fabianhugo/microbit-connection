# J-Link Testing Guide

## Hardware Requirements

- Calliope mini v2 (SEGGER J-Link OB, USB VID:PID 0x1366:0x1025)
- USB cable
- Computer with Chrome or Edge browser
- Test firmware files (Intel HEX format)

## Pre-Testing Setup

### 1. Build the Project

```bash
npm run build
```

The build should complete without errors. The demo page will be built to `dist/index.html`.

### 2. Start the Demo Server

```bash
npm run demo
```

This will start a local server at `http://localhost:5173` (or similar).

### 3. Prepare Test Firmware

**Option 1: Use existing firmware**
- Download Calliope mini firmware from: https://calliope.cc/en/downloads
- Or use any Intel HEX file compatible with nRF52833

**Option 2: Create minimal test firmware**
A simple blink program is ideal for initial testing (~20-50KB).

## Testing Procedure

### Test 1: Device Connection

1. Open demo page in browser (Chrome or Edge)
2. Connect Calliope mini v2 via USB
3. Click "Connect" button
4. Select "Calliope mini" from browser's device picker
5. **Expected results:**
   - Connection succeeds
   - Console shows: "J-Link interface claimed"
   - Device info displays board ID `9902` (Calliope v2)
   - Serial number displays (12 characters)

**What to check:**
- [ ] Device appears in browser picker
- [ ] Connection completes without errors
- [ ] Board ID shows `9902`
- [ ] Console shows J-Link interface claimed
- [ ] No error messages in console

### Test 2: Small Firmware Flash

1. Connect device (if not already connected)
2. Select a small test hex file (<50KB)
3. Click "Flash" button
4. **Expected results:**
   - Progress bar appears and updates smoothly
   - Console shows:
     - "J-Link flash requested"
     - "Connecting to J-Link probe"
     - "Programming X bytes of hex data"
     - Multiple progress updates
     - "Flash complete"
   - Progress reaches 100%
   - Device automatically resets and runs new program

**What to check:**
- [ ] Progress bar moves smoothly from 0-100%
- [ ] No errors in console
- [ ] Flashing completes (should take 5-15 seconds for small file)
- [ ] Device resets automatically
- [ ] New program runs (LED blinking, etc.)

**Console Output Reference:**
Expected console messages during flashing:
```
J-Link flash requested
Connecting to J-Link probe
Programming XXXXX bytes of hex data
Flash complete
```

### Test 3: Full Firmware Flash

1. Connect device
2. Select a full-size firmware file (~200KB)
3. Click "Flash" button
4. **Expected results:**
   - Progress updates smoothly through ~170 chunks
   - Flashing takes 30-60 seconds
   - Completes successfully
   - Device resets and runs

**What to check:**
- [ ] Handles large files without errors
- [ ] Progress reporting is accurate
- [ ] Completes without timeout
- [ ] Final program runs correctly

### Test 4: Error Handling

**Test 4a: Disconnect during flash**
1. Start flashing a large file
2. Disconnect USB cable mid-flash
3. **Expected:** Error message displayed, no browser crash

**Test 4b: Invalid hex file**
1. Try to flash a text file or corrupted hex
2. **Expected:** Appropriate error message

**What to check:**
- [ ] Errors are caught and displayed
- [ ] Browser doesn't crash
- [ ] Device remains accessible after error

### Test 5: Serial Communication

**Note:** Serial only works on Windows/macOS, not Linux (kernel driver blocks it).

1. Connect device
2. Click "Serial" button (if available in demo)
3. Type in serial input field
4. **Expected on Windows/macOS:**
   - Characters echo back from device
   - REPL prompt appears (if MicroPython)
   - Commands execute

**What to check:**
- [ ] Serial connection established
- [ ] Characters sent and received
- [ ] No errors in console

**On Linux:**
- Serial in WebUSB will fail (expected)
- Use `/dev/ttyACM0` with system tools instead
- Document this limitation

### Test 6: Backward Compatibility

1. Connect a micro:bit V2 or Calliope mini V1/V3 (DAPLink device)
2. Flash a program
3. **Expected:** Should work exactly as before
4. **What to check:**
   - [ ] DAPLink devices still work
   - [ ] No regression in existing functionality
   - [ ] Partial flashing still available for DAPLink

## Expected Performance

### Flash Times (approximate)

| Firmware Size | Expected Time |
|--------------|---------------|
| 20 KB        | 5-10 seconds  |
| 50 KB        | 10-20 seconds |
| 100 KB       | 20-40 seconds |
| 200 KB       | 40-60 seconds |

### USB Packet Analysis

If you want to verify the protocol is working correctly, open Chrome DevTools console before flashing and you should see:

1. Initial capability check (1 packet)
2. Probe info query (1 packet)
3. Multiple write chunk packets (~170 for 200KB firmware)
4. Finalize command (1 packet)

## Troubleshooting

### Issue: Device not appearing in browser picker

**Possible causes:**
- Browser doesn't support WebUSB (use Chrome/Edge)
- Device not connected or faulty cable
- USB port not working

**Solution:** Try different USB port, cable, or browser

### Issue: "Unable to claim interface" error

**Possible causes:**
- Another application using the device
- Browser security restrictions

**Solution:** 
- Close other programs that might use the device
- Try restarting the browser
- On Linux, check if kernel driver is bound (expected for CDC)

### Issue: Flash fails immediately

**Possible causes:**
- Invalid hex file
- Device firmware issue
- USB communication problem

**Solution:**
- Verify hex file is valid Intel HEX format
- Check console for specific error messages
- Try unplugging/replugging device
- Check browser console for detailed error

### Issue: Flash hangs/times out

**Possible causes:**
- Large file size
- Slow USB connection
- Device issue

**Solution:**
- Try smaller test file first
- Check USB cable quality
- Restart device

### Issue: Device doesn't reset after flash

**Possible causes:**
- Flash didn't complete successfully
- Device firmware issue

**Solution:**
- Check if flash actually completed (console shows "Flash complete")
- Manually reset device by pressing reset button
- Try flashing again

## Debugging Tips

### Enable Verbose Logging

The demo page already logs to console. For more detail, you can modify the logging level:

1. Open browser DevTools console
2. Before flashing, enable detailed logging if available
3. Check for any warnings or errors

### Capture USB Packets

To see the actual USB packets being sent:

1. Open DevTools console
2. Paste the USB interception code (see `current.log` for example)
3. Flash a small file
4. Copy console output showing hex bytes

This helps verify the protocol is working correctly.

### Check Device State

After failed flash attempt:
1. Check if device is still responsive
2. Try reconnecting
3. Check device LED patterns for error states
4. Try manual reset button

## Reporting Issues

If you encounter problems, please report with:

1. **Hardware details:**
   - Device model and serial number
   - USB VID:PID (should be 0x1366:0x1025)
   - Operating system and version

2. **Firmware details:**
   - Hex file size
   - Source/type of firmware

3. **Error details:**
   - Full console output (copy from DevTools)
   - Screenshots of error messages
   - Steps to reproduce

4. **Test results:**
   - Which tests passed/failed
   - Progress percentage where failure occurred
   - Any USB packet captures if available

## Success Criteria

The implementation is considered successful when:

- ✅ Device connects reliably
- ✅ Small test firmware flashes successfully
- ✅ Full firmware flashes successfully
- ✅ Progress reporting works accurately
- ✅ Device resets and runs after flash
- ✅ No browser crashes or hangs
- ✅ Error handling is graceful
- ✅ DAPLink devices still work (no regression)

## Next Steps After Testing

Once testing confirms the implementation works:

1. Update README with "Full support" status for Calliope mini V2
2. Add any discovered quirks/limitations to documentation
3. Consider adding automated tests
4. Prepare release notes
5. Notify users/developers of new support

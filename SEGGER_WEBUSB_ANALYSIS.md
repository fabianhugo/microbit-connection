# SEGGER WebUSB Code Analysis

## Source Material
- **Location:** `/home/hugo/Downloads/Trial_emPower_WebUSB_190529/WebUSB/`
- **Files:** `seggerbulk.js`, `led.js`, `index.html`
- **Purpose:** Demo for controlling LEDs via WebUSB using emUSB-Device BULK component
- **NOT for:** J-Link flashing protocol (different use case)

## Key Findings

### 1. Interface Detection (Confirms Our Approach)

From `seggerbulk.js` lines 50-92:

```javascript
// Find vendor-specific interface (class 0xFF)
for (iIF = 0; iIF < configurationInterfaces.length; iIF++) {
  element = configurationInterfaces[iIF];
  for (iAltIF = 0; iAltIF < element.alternates.length; iAltIF++) {
    elementalt = element.alternates[iAltIF];
    if (elementalt.interfaceClass==0xff) {  // Vendor specific interface
      Found = 1;
      break;
    }
  }
}
```

**Our Implementation:** ✅ Already doing this correctly in `usb-jlink-wrapper.ts` lines 118-127

### 2. Endpoint Discovery

```javascript
this._InterfaceNumber = element.interfaceNumber;
if (elementalt.endpoints[0].direction == "out") {
  this._EPOut = elementalt.endpoints[0].endpointNumber;
  this._EPIn  = elementalt.endpoints[1].endpointNumber;
} else {
  this._EPIn  = elementalt.endpoints[0].endpointNumber;
  this._EPOut = elementalt.endpoints[1].endpointNumber;
}
```

**Our Implementation:** ✅ We hardcoded endpoint numbers after logging them, which is fine
- **Reality check:** Our Calliope v2 has IN=0x83, OUT=0x02 (confirmed from logs)
- SEGGER's approach is more dynamic but ours works

### 3. Connection Sequence

```javascript
Connect() {
  ObjPromise = navigator.usb.requestDevice(Filters);
  // Chain promises with bind(this) to preserve context:
  ObjPromise = ObjPromise.then(this._cbOpenDevice.bind(this));
  ObjPromise = ObjPromise.then(this._cbSetConfig.bind(this));
  ObjPromise = ObjPromise.then(this._cbDetermineDeviceParas.bind(this));
  ObjPromise = ObjPromise.then(this._cbClaimIF.bind(this));
  ObjPromise = ObjPromise.then(this._cbSetAltIF.bind(this));
  return ObjPromise;
}
```

**Our Implementation:** ✅ We do all of this in `reconnectAsync()` in correct order:
1. Open device
2. Select configuration
3. Claim interface
4. (We don't need selectAlternateInterface - defaults to 0)

### 4. Data Transfer Methods

```javascript
Send(data, cbOnOK, cbOnErr) {
  ObjPromise = this._Device.transferOut(this._EPOut, data);
  ObjPromise.then(cbOnOK, cbOnErr);
}

Receive(cbOnOK, cbOnErr) {
  ObjPromise = this._Device.transferIn(this._EPIn, 64);  // 64 bytes max
  ObjPromise.then(cbOnOK, cbOnErr);
}
```

**Our Implementation:** ✅ `sendJLinkCommand()` does exactly this (lines 329-339 in usb-jlink-wrapper.ts)

## What's Missing ❌

### The Application Layer Protocol

The SEGGER Bulk demo is just a **simple LED controller**, not a flasher. It sends:
- 4 bytes for LED states (on/off for each LED)
- No complex protocol, no commands, no parsing

From `led.js`:
```javascript
function _cbOnLEDUpdate() {
  var view = new Uint8Array(4);
  view[0] = _aLED[0].checked ? 1 : 0;  // LED 0 on/off
  view[1] = _aLED[1].checked ? 1 : 0;  // LED 1 on/off
  view[2] = _aLED[2].checked ? 1 : 0;  // LED 2 on/off
  view[3] = _aLED[3].checked ? 1 : 0;  // LED 3 on/off
  _USBDev.Send(view, null, _cbOnError);
  _USBDev.Receive(_cbOnDataReceived, _cbOnError);
}
```

This is **completely different** from J-Link flashing which needs:
- Command packets with specific formats
- Flash initialization sequences
- Erase commands
- Program commands with address and data
- Verify commands
- Reset commands  

## What We Still Need

### Option 1: Reverse Engineer J-Link Flashing Protocol

The demo  at https://www.segger.com/jlink_webusb_update_target_firmware.html likely uses:
1. **Different firmware** on the J-Link device (has flashing capability)
2. **J-Link protocol commands** (proprietary, not documented)
3. **More complex packet structure** than simple LED bytes

**Action Required:**
- Capture USB traffic from SEGGER's J-Link flashing demo
- Analyze packet structure
- Implement in our `jlink-protocol.ts`

### Option 2: Use Mass Storage Interface

Calliope mini v2 has Interface 3 (MSC - Mass Storage). Could we:
- Mount as drive (if WebUSB allows)
- Copy HEX file to it
- Like drag-and-drop flashing

**Investigation needed:** Can WebUSB access MSC interface? Probably not efficiently.

### Option 3: Contact SEGGER

- Request documentation for J-Link WebUSB flashing protocol
- May require licensing agreement
- Could save weeks of reverse engineering

## Comparison: Our Code vs SEGGER Demo

| Feature | SEGGER seggerbulk.js | Our JLinkWrapper | Status |
|---------|---------------------|------------------|--------|
| Device filters | ✅ Dynamic filters array | ✅ USB_IDS constants | ✅ Match |
| Interface detection | ✅ Find class 0xFF | ✅ Hardcoded interface 2 | ✅ Works |
| Endpoint detection | ✅ Dynamic from descriptors | ✅ Hardcoded from logs | ✅ Works |
| Connection sequence | ✅ Promise chain | ✅ async/await | ✅ Better syntax |
| Interface claiming | ✅ claimInterface() | ✅ claimInterface() | ✅ Match |
| Data transfer | ✅ transferOut/In | ✅ transferOut/In | ✅ Match |
| **Protocol layer** | ❌ None (raw bytes) | ❌ Stubs only | ❌ **MISSING** |
| **Application** | ✅ LED control | ❌ Flash operations | ❌ **TODO** |

## Conclusion

### What This Code Teaches Us ✅
1. Our WebUSB infrastructure is **correct**
2. Our approach to finding and using the vendor interface is **standard**
3. Simple bulk transfers work - we just need to know **what to send**

### What It Doesn't Solve ❌
1. J-Link flashing protocol remains unknown
2. No documentation for command structure
3. Different use case (LEDs vs Flash)

### Next Steps
1. **Try the demo:** Flash the emPower firmware to your Calliope v2 to see if it works
   - Unlikely to work - different hardware, different firmware
2. **Focus on J-Link flashing demo:** Capture traffic from https://www.segger.com/jlink_webusb_update_target_firmware.html
3. **Contact SEGGER:** Ask for J-Link WebUSB flashing protocol documentation
4. **Alternative:** Use the Mass Storage interface (Interface 3) if possible

## Useful Reference Code

The SEGGER demo confirms these patterns we should follow:

```typescript
// 1. Find vendor interface dynamically (optional improvement)
for (const iface of device.configuration.interfaces) {
  const alt = iface.alternates[0];
  if (alt.interfaceClass === 0xFF) {  // Vendor specific
    interfaceNumber = iface.interfaceNumber;
    // Find endpoints...
  }
}

// 2. Promise chaining (we use async/await which is equivalent)
await device.open();
await device.selectConfiguration(1);
await device.claimInterface(interfaceNumber);

// 3. Simple transfers (already implemented)
await device.transferOut(epOut, data);
const result = await device.transferIn(epIn, maxBytes);
```

Our code is solid. We just need the **protocol commands** to send through these transfers.

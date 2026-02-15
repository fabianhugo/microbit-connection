# micro:bit connection library

<a href="https://microbit-foundation.github.io/microbit-connection/" class="typedoc-ignore">This documentation is best viewed on the documentation site rather than GitHub or NPM package site.</a>

A TypeScript library for connecting to micro:bit devices via USB and Bluetooth. Works in browsers (via WebUSB and Web Bluetooth) and in native iOS/Android apps (via [Capacitor](https://capacitorjs.com/)).

[Available on NPM](https://www.npmjs.com/package/@microbit/microbit-connection).

### Demo apps

- [Web demo](https://microbit-connection.pages.dev/) ([source](apps/demo/)) — WebUSB and Web Bluetooth in the browser
- [Capacitor demo](apps/capacitor/) — Bluetooth on iOS and Android via Capacitor

### Projects using this library

- [micro:bit CreateAI](https://github.com/microbit-foundation/ml-trainer/) — uses USB and Bluetooth connections
- [micro:bit Python Editor](https://github.com/microbit-foundation/python-editor-v3/) — [migration in progress](https://github.com/microbit-foundation/python-editor-v3/pull/1190)

### Platform support

| Feature | Web (browser) | Native (Capacitor) |
|---|---|---|
| USB connection | WebUSB | Not supported |
| Bluetooth connection | Web Bluetooth | iOS and Android |
| Flash via USB | Yes | Not supported |
| Flash via Bluetooth | Not supported | iOS and Android |

## Entrypoints

The library is split into separate entrypoints for tree-shaking. Import shared types from the root and connection-specific code from subpaths:

| Import path | Contents |
|---|---|
| `@microbit/microbit-connection` | Shared types and events (`ConnectionStatus`, `DeviceConnection`, `FlashOptions`, etc.) |
| `@microbit/microbit-connection/bluetooth` | `createBluetoothConnection` and Bluetooth connection types |
| `@microbit/microbit-connection/usb` | `createWebUSBConnection` and USB connection types |
| `@microbit/microbit-connection/universal-hex` | `createUniversalHexFlashDataSource` (depends on `@microbit/microbit-universal-hex`) |
| `@microbit/microbit-connection/radio-bridge` | `createRadioBridgeConnection` for micro:bit radio bridge connections |

## Usage

### Flash a micro:bit

Instantiate a WebUSB connection using {@link @microbit/microbit-connection/usb!createWebUSBConnection | createWebUSBConnection} and use it to connect to a micro:bit.

```ts
import { createWebUSBConnection } from "@microbit/microbit-connection/usb";

const usb = createWebUSBConnection();
const connectionStatus = await usb.connect();

console.log("Connection status: ", connectionStatus);
```

{@link @microbit/microbit-connection!ConnectionStatus | Connection status} is `"CONNECTED"` if connection succeeds.

Flash a universal hex that supports both V1 and V2:

```ts
import { createUniversalHexFlashDataSource } from "@microbit/microbit-connection/universal-hex";

await usb.flash(createUniversalHexFlashDataSource(universalHexString), {
  partial: true,
  progress: (stage, percentage) => {
    console.log(stage, percentage);
  },
});
```

This code will also work for non-universal hex files so is a good default for unknown hex files.

Alternatively, you can create and flash a hex for a specific micro:bit version by providing a function that takes a {@link @microbit/microbit-connection!BoardVersion} and returns a hex.
This can reduce download size or help integrate with APIs that produce a hex for a particular device version.
This example uses the [@microbit/microbit-fs library](https://microbit-foundation.github.io/microbit-fs/) which can return a hex based on board id.

```ts
import { MicropythonFsHex, microbitBoardId } from "@microbit/microbit-fs";
import { BoardId } from "@microbit/microbit-connection";

const micropythonFs = new MicropythonFsHex([
  { hex: microPythonV1HexFile, boardId: microbitBoardId.V1 },
  { hex: microPythonV2HexFile, boardId: microbitBoardId.V2 },
]);
// Add files to MicroPython file system here (omitted for simplicity)
// Flash the device
await usb.flash(
  async (boardVersion) => {
    const boardId = BoardId.forVersion(boardVersion).id;
    return micropythonFs.getIntelHex(boardId);
  },
  {
    partial: true,
    progress: (stage, percentage) => {
      console.log(stage, percentage);
    },
  },
);
```

For more examples see the [web demo source](apps/demo/src/demo.ts) and the [Capacitor demo source](apps/capacitor/src/).

### Connect via Bluetooth

By default, the micro:bit's Bluetooth service is not enabled. Visit our [Bluetooth tech site page](https://tech.microbit.org/bluetooth/) to download a hex file that would enable the bluetooth service.

Instantiate a Bluetooth connection using {@link @microbit/microbit-connection/bluetooth!createBluetoothConnection | createBluetoothConnection} class and use it to connect to a micro:bit.

```ts
import { createBluetoothConnection } from "@microbit/microbit-connection/bluetooth";

const bluetooth = createBluetoothConnection();
const connectionStatus = await bluetooth.connect();

console.log("Connection status: ", connectionStatus);
```

{@link @microbit/microbit-connection!ConnectionStatus | Connection status} is `"CONNECTED"` if connection succeeds.

For more examples see the [web demo source](apps/demo/src/demo.ts) and the [Capacitor demo source](apps/capacitor/src/).

## License

This software is under the MIT open source license.

[SPDX-License-Identifier: MIT](LICENSE)

We use dependencies via the NPM registry as specified by the package.json file under common Open Source licenses.

Full details of each package can be found by running `license-checker`:

```bash
$ npx license-checker --direct --summary --production
```

Omit the flags as desired to obtain more detail.

## Code of conduct

Trust, partnership, simplicity and passion are our core values we live and
breathe in our daily work life and within our projects. Our open-source
projects are no exception. We have an active community which spans the globe
and we welcome and encourage participation and contributions to our projects
by everyone. We work to foster a positive, open, inclusive and supportive
environment and trust that our community respects the micro:bit code of
conduct. Please see our [code of conduct](https://microbit.org/safeguarding/)
which outlines our expectations for all those that participate in our
community and details on how to report any concerns and what would happen
should breaches occur.

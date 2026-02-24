/*********************************************************************
*                   (c) SEGGER Microcontroller GmbH                  *
*                        The Embedded Experts                        *
*                           www.segger.com                           *
**********************************************************************

-------------------------- END-OF-HEADER -----------------------------

File    : led.js
Purpose : ...
Literature:
  [1]  ...

Additional information:
  <Any additional information for this module>
*/

/*********************************************************************
*
*       Defines, configurable
*
**********************************************************************
*/

const _DEBUG = 0;   // 1 == debug output to browser console

/*********************************************************************
*
*       Defines, fixed
*
**********************************************************************
*/
//
// J-Link USB commands
//
const EMU_CMD_GET_PROBE_INFO                      = 28;
const EMU_CMD_GET_CAPS_EX                         = 237;
const EMU_CMD_GET_PROBE_INFO_CMD_GET_CAPS         = 0;
const EMU_PROBE_INFO_SUB_CMD_WRITE_MSD_IMG_CHUNK  = 5;
const EMU_PROBE_INFO_SUB_CMD_WRITE_MSD_IMG_END    = 6;
//
// J-Link USB capabilities
//
const EMU_CAP_EX_GET_PROBE_INFO                   = 64;           // Supports EMU_CMD_GET_PROBE_INFO
//
// Caps for EMU_CMD_GET_PROBE_INFO
//
const EMU_PROBE_INFO_CAP_MSD_IMG                  = 2;

/*********************************************************************
*
*       Static data
*
**********************************************************************
*/

var _USBPort;
var _hFileSel;
var _ActiveCmd = { NumBytesReceived: 0 };
var _FWFileInfo = { aData : null, NumBytesWritten : 0 };
var _hProgBar;
var _IsConnected = 0;
var _tProgrammingStart;

/*********************************************************************
*
*       Local functions
*
**********************************************************************
*/

/*********************************************************************
*
*       _LogOut()
*/
function _LogOut(sLog) {
  if (_DEBUG) {
    console.log(sLog);
  }
}

/*********************************************************************
*
*       _PROGBAR_SetProgress()
*
*  Function description
*    Sets the passed percentage as the current progress.
*/
function _PROGBAR_SetProgress(Percentage) {
  if (Percentage > 100) {
    Percentage = 0;
  }
  sTmp = Percentage + "%";
  _hProgBar.style.width = sTmp;
  _hProgBar.innerHTML = sTmp;
}

/*********************************************************************
*
*       _Load32LE()
*
*  Function description
*    Called when user clicks the "Connect" button
*/
function _Load32LE(aByte){
  var v;
  var i;
  var NumBytes;
  var Shift;

  NumBytes = aByte.length;
  if (NumBytes > 4) {
    NumBytes = 4;
  }
  v     = 0;
  Shift = 0;
  for (i = 0; i < NumBytes; i++) {
    v |= aByte[i] << Shift;
    Shift += 8;
  }
  return v;
}

/*********************************************************************
*
*       _Bin2String()
*/
function _Bin2String(array, iStart, NumBytes) {
  var result;
  var i;

  result = "";
  for (var i = 0; i < NumBytes; i++) {
    result += String.fromCharCode(parseInt(array[iStart], 10));  // Parse byte array as decimal numbers and convert them to characters
    iStart++;
  }
  return result;
}

/*********************************************************************
*
*       _ConcatTypedArrays()
*/
function _ConcatTypedArrays(a, b) { // a, b TypedArray of same type
  var c;

  c = new (a.constructor)(a.length + b.length);
  c.set(a, 0);
  c.set(b, a.length);
  return c;
}

/*********************************************************************
*
*       _DeInit()
*/
function _DeInit() {
  if (_IsConnected) {
    _USBPort.Disconnect();
  }
  //
  // Reset statics
  //
  _IsConnected = 0;
  _USBPort = null;                                 // Invalidate port
  _ActiveCmd.NumBytesReceived = 0;
  _FWFileInfo.aData = null
  _FWFileInfo.NumBytesWritten = 0;
}

/*********************************************************************
*
*       _cbOnError()
*
*  Function description
*    Called in case something goes wrong.
*    Disconnects from USB device if connected and resets internal state
*/
function _cbOnError(error) {
  _LogOut("_cbOnError(): " + error);
  document.getElementById("status").innerHTML = error;
  _DeInit();
}

/*********************************************************************
*
*       _cbUSB_OnRecvError()
*
*  Function description
*    Called when a receive error happens on USB.
*/
function _cbUSB_OnRecvError(error) {
  _LogOut("_cbUSB_OnRecvError()" + error);
  _cbOnError("USB receive error: " + error);
}

/*********************************************************************
*
*       _cbUSB_OnSendError()
*
*  Function description
*    Called in case a USB write operation failed.
*
*  Notes
*    (1) The object that is passed to us is a <USBOutTransferResult> which is not documented yet (190523)
*        However, in the source code we found the definition of the attributes and methods
*        https://chromium.googlesource.com/chromium/blink/+/master/Source/modules/webusb/USBOutTransferResult.h
*/
function _cbUSB_OnSendError(Value) {
  var v;

  v = Value.status;
  _LogOut("_cbUSB_OnSendError(): " + v);
  _cbOnError("USB send error: " + v);
}

/*********************************************************************
*
*       _CheckAllBytesReceived()
*
*  Function description
*    Copies data into static buffer
*    Checks if all required bytes have been received for currently active command.
*    If there is still data to be read, this function also schedules a new read
*/
function _CheckAllBytesReceived(data, MinNumBytesReceived, cbOnOK, cbOnError) {
  var aDataTmp;
  var r;
  //
  // Copy received bytes into static buffer
  // If this is a consecutive read, append data
  // If we did not receive all bytes yet, trigger another read
  //
  _LogOut("_CheckAllBytesReceived()");
  r = 0;
  if (_ActiveCmd.NumBytesReceived) {
    _LogOut("_CheckAllBytesReceived(): Concat " + data.byteLength + " bytes");
    aDataTmp = new Uint8Array(data.buffer);               // Copy data into new tmp array
    _aDataBuf = _ConcatTypedArrays(_aDataBuf, aDataTmp);  // Add bytes to buffer
  } else {
    _LogOut("_CheckAllBytesReceived(): Copy " + data.byteLength + " bytes");
    _aDataBuf = new Uint8Array(data.buffer);              // Copy data into new tmp array
  }
  _ActiveCmd.NumBytesReceived += data.byteLength;
  if (_ActiveCmd.NumBytesReceived < MinNumBytesReceived) {
    _USBPort.Receive(cbOnOK, cbOnError);                  // Schedule another read
    r = -1;
  }
  return r;
}

/*********************************************************************
*
*       _SendImgEnd()
*
*  Function description
*    Sends EMU_PROBE_INFO_SUB_CMD_WRITE_MSD_IMG_END to finalize the programming of the application image
*/
function _SendImgEnd() {
  var aData;
  //
  // File download end
  // H->E 1-byte           <Cmd>
  // H->E 1-byte           <SubCmd> == EMU_PROBE_INFO_SUB_CMD_WRITE_MSD_IMG_END
  // H<-E 4-bytes          <Response>  != 0 indicates that an error string is following and describes the length of this string
  //
  _LogOut("_SendImgEnd()");
  aData                       = new Uint8Array(1 + 1);
  aData[0]                    = EMU_CMD_GET_PROBE_INFO;
  aData[1]                    = EMU_PROBE_INFO_SUB_CMD_WRITE_MSD_IMG_END;
  _ActiveCmd.NumBytesReceived = 0;
  _USBPort.Send(aData, null, _cbUSB_OnSendError);          // Queues write. Do not call anything in case of transfer succeeded, only in error case
  _USBPort.Receive(_cbCheckProgResult, _cbUSB_OnRecvError);        // Receive response: Schedule read. Callbacks are called on completion. Logic continues there
}

/*********************************************************************
*
*       _SendImgChunk()
*
*  Function description
*    Sends EMU_PROBE_INFO_SUB_CMD_WRITE_MSD_IMG_CHUNK to send the next chunk of the application image to the target
*/
function _SendImgChunk() {
  var aData;
  var v;
  var iWrite;
  var iFileData;
  //
  // File download
  // H->E 1-byte           <Cmd>
  // H->E 1-byte           <SubCmd> == EMU_PROBE_INFO_SUB_CMD_WRITE_MSD_IMG_CHUNK
  // H->E 4-bytes          <NumBytes> Number of bytes to write
  // H->E <NumBytes>-bytes <Data>
  //
  _LogOut("_SendImgChunk()");
  document.getElementById("status").innerHTML = "Programming file...";
  v = _FWFileInfo.aData.byteLength - _FWFileInfo.NumBytesWritten;
  if (v > 4096) {             // Make sure that we do send in small chunks to make sure a single command never takes too long to complete
    v = 4096;
  }
  aData                       = new Uint8Array(1 + 1 + 4 + v);
  aData[0]                    = EMU_CMD_GET_PROBE_INFO;
  aData[1]                    = EMU_PROBE_INFO_SUB_CMD_WRITE_MSD_IMG_CHUNK;
  aData[2]                    = (v >>  0) & 0xFF;
  aData[3]                    = (v >>  8) & 0xFF;
  aData[4]                    = (v >> 16) & 0xFF;
  aData[5]                    = (v >> 24) & 0xFF;
  iWrite = 6;
  iFileData = _FWFileInfo.NumBytesWritten;
  for (i = 0; i < v; i++) {    // Copy data from file buffer into local one
    aData[iWrite] = _FWFileInfo.aData[iFileData];
    iFileData++;
    iWrite++;
  }
  _ActiveCmd.NumBytesReceived = 0;
  _LogOut("_SendImgChunk(): USB packet: " + aData.byteLength + " bytes");
  _USBPort.Send(aData, _cbWriteNextImgChunk, _cbUSB_OnSendError); // Queues write. Started as soon as we leave the javascript functions (javascript is single-threaded)
}

/*********************************************************************
*
*       _cbCheckProgResult()
*
*  Function description
*    Called when we received the response to the "image finished" command.
*/
function _cbCheckProgResult(data) {
  var tDelta;

  data = data.data;                     // Point to <DataView> of USBResult object
  _LogOut("_cbCheckProgResult()");
  r = _CheckAllBytesReceived(data, 4, _cbCheckProgResult, _cbUSB_OnRecvError);  // Check if everything has been received. If not, the next read is automatically scheduled
  if (r < 0) {
    return;
  }
  v = _Load32LE(_aDataBuf);
  if (v) {                                 // Error there? => Wait until error string is also received
    if (_ActiveCmd.NumBytesReceived < (v + 4)) {
      return;
    }
  }
  tDelta = new Date().getTime();
  tDelta -= _tProgrammingStart;
  if (tDelta > 1000) {
    //
    // Convert [ms] to [s].[ms] with one decimal space
    //
    tDelta += 50;                     // Round to multiple of 100ms
    sTime = parseInt(tDelta / 1000);  // Cut off decimal part
    sTime += ".";
    tDelta = tDelta % 1000;
    tDelta = parseInt(tDelta / 100);  // Cut of decimal part
    sTime += tDelta;
    sTime += "s";
  } else {
    sTime = tDelta + "ms";
  }
  if (v == 0) {
    document.getElementById("status").innerHTML = "Update completed (took " + sTime + ")";
  } else {
    sErr = _Bin2String(_aDataBuf, 4, v);
    document.getElementById("status").innerHTML = "Update FAILED (took " + tDelta + "ms): " + sErr;
  }
  _ActiveCmd.NumBytesReceived = 0;
  _DeInit();
}

/*********************************************************************
*
*       _cbWriteNextImgChunk()
*
*  Function description
*    Called in case a chunk of the image was written successfully.
*
*  Notes
*    (1) See _cbUSB_OnSendError()
*/
function _cbWriteNextImgChunk(Value) {
  var v;
  var Percentage;
  //
  // Update progress bar in GUI
  //
  v = Value.bytesWritten - 6;                             // We are only interested in the payload, so remove the command overhead (See _SendImgChunk() for command protocol)
  _LogOut("_cbUSBWrite_OnOK(): " + v + " bytes");
  _FWFileInfo.NumBytesWritten += v;
  Percentage = Number((_FWFileInfo.NumBytesWritten * 100) / _FWFileInfo.aData.byteLength);
  Percentage = parseInt(Percentage);
  _PROGBAR_SetProgress(Percentage);
  //
  // Trigger write of next chunk, if any
  // If no more chunks are available, trigger the finalize command
  //
  v = _FWFileInfo.aData.byteLength - _FWFileInfo.NumBytesWritten;
  if (v) {                                                          // Something else to write? => Trigger next chunk
    _LogOut("_cbWriteNextImgChunk(): Sending EMU_PROBE_INFO_SUB_CMD_WRITE_MSD_IMG_CHUNK");
    _SendImgChunk();                                                // Starts asynchronous operation. We will get into _cbUSB_OnReceive() again once we received something on the USB level
  } else {                                                          // Nothing else to write? => Send finalize command to FW
    _LogOut("_cbWriteNextImgChunk(): Sending EMU_PROBE_INFO_SUB_CMD_WRITE_MSD_IMG_END");
    _SendImgEnd();
  }
}

/*********************************************************************
*
*       _cbCheckCapsGetProbeInfo()
*/
function _cbCheckCapsGetProbeInfo(data) {
  var r;
  var v;

  _LogOut("_cbCheckCapsGetProbeInfo()");
  data = data.data;                     // Point to <DataView> of USBResult object
  r = _CheckAllBytesReceived(data, 4, _cbCheckCapsGetProbeInfo, _cbUSB_OnRecvError);  // Check if everything has been received. If not, the next read is automatically scheduled
  if (r < 0) {
    return;
  }
  //
  // Check if J-Link supports command to write application image file to target
  //
  v = _Load32LE(_aDataBuf);
  v = (v >> EMU_PROBE_INFO_CAP_MSD_IMG) & 1;
  _LogOut("J-Link reports EMU_PROBE_INFO_CAP_MSD_IMG == " + v);
  if (v == 0) {
    v = "This J-Link does not support file flash download";
    _LogOut(v);
    _cbOnError(v);
    return;
  }
  //
  // Trigger next command
  //
  _tProgrammingStart = new Date().getTime();
  _SendImgChunk();
}

/*********************************************************************
*
*       _cbCheckCapsEx()
*/
function _cbCheckCapsEx(data) {
  var r;
  var v;
  var BitPos;
  var aData;

  _LogOut("_cbCheckCapsEx()");
  data = data.data;                     // Point to <DataView> of USBResult object
  r = _CheckAllBytesReceived(data, 32, _cbCheckCapsEx, _cbUSB_OnRecvError);  // Check if everything has been received. If not, the next read is automatically scheduled
  if (r < 0) {
    return;
  }
  //
  // Evaluate response
  //
  if (_DEBUG) {
    for (i = 0; i < _aDataBuf.byteLength; i++) {
      _LogOut("Caps[" + i + "]: " + _aDataBuf[i]);
    }
  }
  v = EMU_CAP_EX_GET_PROBE_INFO >> 3;          // Byte offset
  BitPos = EMU_CAP_EX_GET_PROBE_INFO & 7;
  v = _aDataBuf[v];                            // Get byte that contains capability
  v = (v >> BitPos) & 1;
  _LogOut("J-Link reports EMU_CAP_EX_GET_PROBE_INFO == " + v);
  if (v == 0) {
    v = "This J-Link does not support file flash download";
    _LogOut(v);
    _cbOnError(v);
    return;
  }
  //
  // Trigger new command
  //
  _ActiveCmd.NumBytesReceived = 0;
  aData                       = new Uint8Array(2);
  aData[0]                    = EMU_CMD_GET_PROBE_INFO;
  aData[1]                    = EMU_CMD_GET_PROBE_INFO_CMD_GET_CAPS;
  _LogOut("_cbCheckCapsEx(): Sending EMU_CMD_GET_PROBE_INFO_CMD_GET_CAPS");
  _USBPort.Send(aData, null, _cbUSB_OnSendError);                  // Queues write. Callbacks are called on write completion (None here for O.K.)
  _USBPort.Receive(_cbCheckCapsGetProbeInfo, _cbUSB_OnRecvError);  // Receive response: Schedule read. Callbacks are called on completion. Logic continues there
}

/*********************************************************************
*
*       _cbOnFWFileLoad()
*
*  Function description
*    Called when loading the firmware file on the PC is complete
*/
function _cbOnFWFileLoad(EventFileLoaded) {
  let aData;
  let ObjPromise;
  //
  // Update GUI elements
  //
  _LogOut("_cbOnFWFileLoad()");
  _FWFileInfo.aData           = new Uint8Array(EventFileLoaded.target.result);  // Event result contains an <ArrayBuffer> object which we copy into a byte array
  _FWFileInfo.NumBytesWritten = 0;
  _LogOut("File size: " + Number(_FWFileInfo.aData.byteLength));
  //
  // Check if J-Link supports the top level USB command at all
  //
  document.getElementById("status").innerHTML = "Checking J-Link capabilities...";
  _ActiveCmd.NumBytesReceived = 0;
  aData                       = new Uint8Array(1);
  aData[0]                    = EMU_CMD_GET_CAPS_EX;
  _LogOut("_cbOnFWFileLoad(): Sending EMU_CMD_GET_CAPS_EX");
  ObjPromise =_USBPort.Send(aData, null, _cbUSB_OnSendError);  // Queues write. Callbacks are called on write completion (None here for O.K.)
  _USBPort.Receive(_cbCheckCapsEx, _cbUSB_OnRecvError);         // Receive response: Schedule read. Callbacks are called on completion. Logic continues there
}

/*********************************************************************
*
*       _cbLoadFile()
*
*  Function description
*    Loads the firmware image file.
*    Called in case connecting to the USB device was O.K.
*/
function _cbLoadFile() {
  var fileToLoad;
  var fileReader;
  //
  // Update GUI
  //
  _LogOut("_cbLoadFile()");
  _IsConnected = 1;                                    // Indicate that USB connection was successful
  document.getElementById("status").innerHTML = "Loading file...";
  fileToLoad        = _hFileSel.files[0];              // Get file from HTML file selector element
  fileReader        = new FileReader();
  fileReader.onload = _cbOnFWFileLoad;                 // Register callback that is called as soon as the file contents are loaded
  fileReader.readAsArrayBuffer(fileToLoad, "UTF-8");   // Schedules asynchronous operation
}

/*********************************************************************
*
*       Global functions
*
**********************************************************************
*/

/*********************************************************************
*
*       PROGRAMMING_cbOnClick_BtnUpdateFW()()
*
*  Function description
*    Called when the "upload FW" button is clicked
*/
function PROGRAMMING_cbOnClick_BtnUpdateFW() {
  var ObjPromise;
  var is_Chrome;
  //
  // Early outs
  //
  _LogOut("PROGRAMMING_cbOnClick_BtnUpdateFW()");
  if (_IsConnected) {                       // Already connected? => Done
    return;
  }
  if (_hFileSel.files[0] == null) {         // No file selected? => Error, do not try to connect
    document.getElementById("status").innerHTML = "ERROR: No FW file selected";
    return;
  }
  //
  // Trigger connect
  //
  document.getElementById("status").innerHTML = "Opening USB connection...";
  _USBPort = new SeggerBulk();
  ObjPromise = _USBPort.Connect();                        // Schedules asynchronous connect
  ObjPromise.then(_cbLoadFile, _cbOnError);               // Starts asynchronous operation. Further execution of logic resumes in OK/error callbacks);
}

(function() {
  'use strict';

  document.addEventListener('DOMContentLoaded', event => {
    _hFileSel = document.getElementById("FileSel")
    _hProgBar = document.getElementById("ProgBar");
    _hFileSel.addEventListener('change', PROGRAMMING_cbOnClick_BtnUpdateFW);
  });
})();
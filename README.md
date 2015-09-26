A meteor app to detect and configure devices over Bluetooth Low Energy

# Android
Even though cordova is cross-platform, I have only tested it with Android yet.  

## Setup
https://www.meteor.com/tutorials/blaze/running-on-mobile

## Running

```
//local server
meteor run android-device -p <local port>  # meteor server is spawned on your computer

//production server
meteor run android-device -v --mobile-server <remote server>
```

## Prerequisites on the node (i.e. central unit) that will serve BleConfig Service.
* The node should have a ble module and a service with the uuid defined in this module. 
* \>= Node 0.12 (using new features from Buffer package)

## TODO
* Use uuid-1345 lib to generate and parse uuids of the config service and characteristics rather than a preset service uuid.
* BLE and WifiConfig plugins are limited. They need to be updated for better user experience.
  * They do not have callbacks for wifi/ble enable/disable events. So I only check it on onResume event. IF the user enables/disables them by elapsing notification bar on Android, there is no way of detecting it.
  * BLE plugin does not parse advertisements. So I parse it manually. Good idea to add it to the library. (Of course this requires adding it for IPhone as well.)

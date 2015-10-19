_ = lodash;

Devices = new Mongo.Collection(null);
Services = new Mongo.Collection(null);

AccessPoints = new Mongo.Collection(null);

var BLE_SCAN_INTERVAL_IN_SECONDS = 10;

var SERVICE_UUIDS = {
    '1800' : 'Generic Access',
    '1801' : 'Generic Attribute',
    '180F' : 'Battery Service',
    '88888888-1111-2222-3333-56789dddddd0': 'Config'
};

var CHARACTERISTICS_UUIDS = {
    '2902' : 'Client Characteristic Configuration',
    '2a00' : 'Device Name',
    '2A19' : 'Battery Level',
    // 'dddd5678-1234-5678-1234-56789dddddd1': 'WIFI',
    '88888888-1111-2222-3333-56789dddddd01' : 'URL'
};

var SERVICE_UUIDS_BY_NAME = _.invert(SERVICE_UUIDS);
var CHARACTERISTICS_UUIDS_BY_NAME =_.invert(CHARACTERISTICS_UUIDS);

if (Meteor.isCordova) {
    console.log('Cordova Up and Running!');
}

function str2Bytes(str) {
    //Somehow Buffer does not work so had to do it this way
    var bytes = new Uint8Array(str.length);
    for (var i = 0; i < str.length; ++i) {
        bytes[i] = str.charCodeAt(i);
    }
    return bytes;
}


var AD_TYPES = {
    FLAGS : 0x01,
    SERVICE_UUID_16_INCOMPLETE : 0x02,
    SERVICE_UUID_16_COMPLETE : 0x03,
    SERVICE_UUID_32_COMPLETE : 0x04,
    SERVICE_UUID_32_INCOMPLETE : 0x05,
    SERVICE_UUID_128_INCOMPLETE : 0x06,
    SERVICE_UUID_128_COMPLETE : 0x07,
    SERVICE_DATA : 0x16,
    TX_LEVEL : 0x0A,
    MANUFACTURER_SPECIFIC : 0xff
};

var AD_TYPES_BY_VALUE = _.invert(AD_TYPES);

function unparseUuid(uuidArray, size) {
    //uuid arrives in reverse order
    uuidArray.reverse();

    //if a typical 16 bytes uuid then use the library
    if (size === 16) {
        return uuid.unparse(uuidArray);
    }

    //if 2 or 4 bytes from Bluetooth standard, then unparse yourself.
    return uuidArray.map(function(num) {
        var hex = num.toString(16).toLowerCase();
        if (hex.length < 2) {
            hex = '0' + hex;
        }
        return hex;
        }).join('');
}

function clearErrors() {
    Session.set('errorMessage', undefined);
}

function setErrors(err) {
    Session.set('errorMessage', err);
}

function getErrors() {
    return Session.get('errorMessage');
}

//TODO this should be done by ble library actually. MAybe contribute ble plugin.
//Parse services as binary data from advertisement
function parseAdvertisementServices(services, size) {
    function parseAdvertisementService(service) {
        return unparseUuid(service, size);
    }
    var chunks = _.chunk(services, size);
    var parsedServices = chunks.map(parseAdvertisementService);

    return parsedServices;
}

function parseAdvertisement(advertising) {
    var adv = {
        services : []
    };

    if (advertising) {
        var data = new Uint8Array(advertising);
        var len = 0;
        for (var i = 0; i < data.length ;i += len + 1) {
            len = data[i];
            if (len <= 0 || (i + 1 + len) > data.length) {
                console.log('Advertising parse error');
                break;
            }

            var type = data[i+1];
            var value = data.subarray(i+2, i+1+len);

            if (type in AD_TYPES_BY_VALUE) {
                adv[AD_TYPES_BY_VALUE[type]] = value;
            }
        }

        var allServices = [];

        allServices.push(parseAdvertisementServices(adv.SERVICE_UUID_16_COMPLETE, 2));
        allServices.push(parseAdvertisementServices(adv.SERVICE_UUID_16_INCOMPLETE, 2));
        allServices.push(parseAdvertisementServices(adv.SERVICE_UUID_32_COMPLETE, 4));
        allServices.push(parseAdvertisementServices(adv.SERVICE_UUID_32_INCOMPLETE, 4));
        allServices.push(parseAdvertisementServices(adv.SERVICE_UUID_128_COMPLETE, 16));
        allServices.push(parseAdvertisementServices(adv.SERVICE_UUID_128_INCOMPLETE, 16));

        adv.services = _.flatten(allServices);
    }

    return adv;
}

function discoverDevices() {
    Session.set('bleScanOngoing', true);
    Devices.remove({});
    ble.scan([], BLE_SCAN_INTERVAL_IN_SECONDS, onDiscoverDevice.bind(this, null), onBleError);

    Meteor.setTimeout(function(){
            Session.set('bleScanOngoing', false);
    }, BLE_SCAN_INTERVAL_IN_SECONDS * 1000);
}

Template.main.helpers({
    errorMessage: function() {
        return getErrors();
    },
    isBleEnabled: function() {
        return Session.get('bleEnabled');
    },
    isWifiEnabled: function() {
        return Session.get('wifiEnabled');
    }
});

Template.main.events({
    'click #enableBle': function(event){
        event.preventDefault();
        ble.enable(
            function() {
                Session.set('bleEnabled', true);
            }, setErrors
        );
    },
    'click #enableWifi': function(event){
        event.preventDefault();
        WifiWizard.setWifiEnabled(
            true,
            function() {
                Session.set('wifiEnabled', true);
            }, setErrors
        );
    }
});

Template.devices.helpers({
    devices: function () {
        return Devices.find({'parsedAdvertisement.services': SERVICE_UUIDS_BY_NAME.Config});
    },
    bleScanButtonDisabled: function() {
        return Session.get('bleScanOngoing');
    }
});


Template.devices.events({
    'click #refreshButton': function(){
        console.log('You clicked refresh');

        discoverDevices();
    }
});

Template.device.helpers({
    isConnected: function() {
        var device = getSelectedDevice();
        return device && device.state === 'Connected';
    },
    state: function() {
        var device = getSelectedDevice();
        return device.state;
    },
    configService: function() {
        return Services.findOne({_id: SERVICE_UUIDS_BY_NAME.Config});
    }
});

Template.device.events({
    'click #cancelButton': function() {
        disconnect();
        Router.go('/');
    }
});


Template.listdevice.events({
    'click #connectButton': function(event){
        event.preventDefault();
        Router.go('/devices/' + this.id);
    }
});


Template.service.helpers({
    //Blaze does not support each on objects
    charsArray: function() {
        return _.values(this.chars);
    }
});

Template.service.events({});

Template.char.helpers({
    isLink: function (value) {
        //TODO is this enough?
        return value && value.match(/http:\/\//);
    },
    isReadable: function() {return this.properties.indexOf('Read') > -1;},
    isWritable: function() {return this.properties.indexOf('Write') > -1;},

    isWifiChar: function() {return this.id === CHARACTERISTICS_UUIDS_BY_NAME.WIFI;},
    accessPoints: function () {
        return AccessPoints.find();
    },
});

Template.char.events({
    'click #Read': function(){
        var serviceId = this.service;
        var charId = this.id;
        ble.read(
            getSelectedDeviceId(),
            serviceId, charId,
            onReadChar.bind(this), onBleError);
        return false;
    },
    'click #OpenLink': function(evt){
        // window.open(evt.target.value, '_blank', 'location=yes');
        window.open(evt.target.value, '_system', 'location=yes');
        return false;
    },

    'input #WriteInput': function(evt) {
        console.log(evt.target.value);
        this.newValue = evt.target.value;
    },

    'click #Write': function(){
        configWriteChar.call(this, this.newValue);
        return false;
    },

    'click #scanButton': function(){
        AccessPoints.remove({});
        WifiWizard.startScan(
            function(){
                console.log('Scan started', arguments);
                Meteor.setTimeout(getScanResults, 5000);
            }, function(){
                console.log('Scan failed', arguments);
            });
    },

    'submit .wifi-test': function (event) {
      // Prevent default browser form submit
      event.preventDefault();

      // Get value from form element
      var ssid = event.target.accessPointsSelect.value;
      var passphrase = event.target.passphraseInput.value;

      var value = 's=' + encodeURIComponent(ssid) + '&' + 'p=' + encodeURIComponent(passphrase);
      configWriteChar.call(this, value);
    }
});

function configWriteChar(value) {
    var deviceId = getSelectedDeviceId();
    var serviceId = this.service;
    var charId = this.id;
    var newValue = value;

    if (newValue) {
        //If this belongs to config service then enable notificatoins to
        //be able to get the response back!
        if (serviceId === SERVICE_UUIDS_BY_NAME.Config) {
            ble.startNotification(
                getSelectedDeviceId(),
                serviceId, charId,
                onConfigStartNotify.bind(this), onBleError);
        }
        ble.write(deviceId, serviceId, charId, str2Bytes(newValue).buffer,
            function() {console.log('Wrote config');},
            onBleError);
    }
}

Meteor.startup(function () {
    //In case of code hot push, if there was a selected device before, just try to disconnect!
    disconnect();

    discoverDevices();
});

function disconnect(){
    var selectedDeviceId = getSelectedDeviceId();
    if (selectedDeviceId) {
        ble.disconnect(selectedDeviceId, onDisconnect.bind(this),
            function(err) {console.log(err);});
    }
}

function getSelectedDevice() {
    return Session.get('selectedDevice');
}

function getSelectedDeviceId() {
    var id;
    var device = Session.get('selectedDevice');
    if (device) {
        id = device.id;
    }

    return id;
}

function updateDevice(id, newValues) {
    return Devices.update(id, {$set: newValues});
}

function updateService(id, newValues) {
    return Services.update(id, {$set: newValues});
}

function onConnect(peripheral) {
    console.log('Device connected', this._id);

    updateDevice(this._id, {peripheral: peripheral});
    Session.set('selectedDevice', {id:this.id, state:'Connected'});

    //Meteor does not support bulk inserts yet!
    parseServices(peripheral).forEach(
        function(peripheral) {
            Services.insert(peripheral);
        });
}
function onDisconnect() {
    console.log('Device disconnected', this._id);
}

function updateCharValue(char, data) {
    //TODO what if they are not string?
    var value = String.fromCharCode.apply(null, new Uint8Array(data));
    var field = {};
    field['chars.' + char.id +'.value'] = value;
    return updateService(char.service, field);
}

function onConfigStartNotify(data) {
    console.log(data);
    return updateCharValue(this, data);
}

function onReadChar(data) {
    return updateCharValue(this, data);
}

function onDiscoverDevice(err, device) {
    if (err) {
        setErrors(err);
        return;
    }
    console.log(JSON.stringify(device));
    device._id = device.id;
    if (!device.name) {
        device.name = '-';
    }
    device.parsedAdvertisement = parseAdvertisement(device.advertising);
    Devices.insert(device);
}

function onBleError(reason) {
    //alert('ERROR: ' + reason); // real apps should use notification.alert
    setErrors(reason);
}

function onConnectionBleError(reason) {
    console.log('Connection err',reason, this._id);
    Session.set('selectedDevice', {id: this._id, state:reason});
    setErrors(reason);
}

function parseServices(peripheral) {
    function parseChar(char) {
        char.id = char.characteristic;
        char.name = CHARACTERISTICS_UUIDS[char.id] || char.id;
        return char;
    }

    var parsedServices = {};
    var services = peripheral.services || [];
    var chars = peripheral.characteristics || [];

    services.forEach(function(serviceId) {
        var serviceName = SERVICE_UUIDS[serviceId] || serviceId;
        parsedServices[serviceId] = {_id: serviceId, name:serviceName, chars: {}};
    });

    chars.forEach(function(char) {
        var parsedChar = parseChar(char);
        parsedServices[char.service].chars[parsedChar.id] = parsedChar;
    });

    return _.values(parsedServices);
}

function getScanResults() {
    function scanResultHandler(networks) {
        console.log('nws', networks);
        networks.forEach(
            function(network) {
                AccessPoints.insert(network);
            });
    }

    WifiWizard.getScanResults(
        scanResultHandler,
        function() {console.log('Get scan results failed');});
}

Router.route('/', {
    template: 'devices',
    action: function () {
        //init
        Session.set('selectedDevice', null);
        clearErrors();

        // render all templates and regions for this route
        this.render();
  }
});

Router.route('/devices/:_id', {
    template: 'device',
    data: function () {
        var deviceId = this.params._id;
        var device = Devices.findOne({_id: deviceId});

        return device;
    },
    action: function () {
        var deviceId = this.params._id;
        var device = Devices.findOne({_id: deviceId});

        Services.remove({});

        clearErrors();

        Session.set('selectedDevice', {id:deviceId, state:'Connecting'});

        console.log('You clicked connect', deviceId);

        ble.connect(deviceId, onConnect.bind(device), onConnectionBleError.bind(device));

        this.render();
    }
});

Router.configure({
    layoutTemplate: 'main'
});

function checkConfiguration() {
    WifiWizard.isWifiEnabled(function(isEnabled) {
        Session.set('wifiEnabled', isEnabled);
    }, setErrors);

    ble.isEnabled(function(isEnabled){
        Session.set('bleEnabled', isEnabled === 'OK' || isEnabled);
    }, function(){
        Session.set('bleEnabled', false);
    });
}

//Cordova resume event
document.addEventListener("resume", function() {
    checkConfiguration();
});
document.addEventListener("deviceready", function() {
    checkConfiguration();
});

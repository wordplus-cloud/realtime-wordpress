import React, {Dispatch, SetStateAction } from "react";
import {_x} from "../../inc/globals.ts";

/**
 * One of the call settings' device choices (camera, microphone or speaker): the devices the browser lists, the chosen
 * one marked, a change handed back through `setSelectedDevice`.
 */
export default function DeviceSwitch(
    { label, devices, selectedDevice, setSelectedDevice } : {
        label : string,
        devices : Map<string, MediaDeviceInfo>,
        selectedDevice : string,
        setSelectedDevice: Dispatch<SetStateAction<string>>
    } ){

    let options: React.JSX.Element[] = []

    devices.forEach((item) => {
        let label = '';

        if (item['deviceId'] === 'default') {
            label += _x( 'Same as system', 'Media Inputs', 'bp-better-messages') + ' - ';
        }

        if (item['deviceId'] === 'communications') {
            label += _x( 'Communications', 'Media Inputs', 'bp-better-messages') + ' - ';
        }

        label += item['label'];

        options.push(<option key={"device-" + item['deviceId']} value={ item['deviceId'] } data-label={ label }>{ label }</option>);
    });

    return (
        <>
            <div className="bm-call-setting bm-switch-device">
                <label>{ label }</label>
                <div className="bm-switch-device-select-wrap">
                    <select value={selectedDevice} onChange={(event) => {
                        setSelectedDevice(event.target.value);
                    }}>
                        <option value="">{ _x( 'Default', 'Media Inputs', 'bp-better-messages') }</option>
                        { options }
                    </select>
                </div>
            </div>
        </>
    )
}

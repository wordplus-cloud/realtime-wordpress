import {isMobile} from "../functions/browser-info.ts";
import {useEffect, useState } from "react";
import { Subject } from "rxjs";

// Read once the module loads, in a browser. Rendered on a server (a Next.js page's first render), there is no device
// to share or show in picture in picture, and the call screens draw nothing until a call is up in the browser.
const inBrowser = typeof window !== "undefined" && typeof navigator !== "undefined";
export const screenShareSupport : boolean = inBrowser && !! navigator.mediaDevices && "getDisplayMedia" in navigator.mediaDevices
export const pictureInPictureSupport : boolean = inBrowser && ! isMobile() && 'pictureInPictureEnabled' in document

export const mediaAccess : Map<string, string> = new Map([
    ['microphone', 'unknown'],
    ['camera', 'unknown']
]);

const media = inBrowser ? navigator.mediaDevices : undefined;

let monitorStarted = false;

function startChangeMonitor(){
    if( ! monitorStarted && media && media.ondevicechange ) {
        monitorStarted = true;
        navigator.mediaDevices.ondevicechange = (event) => {
            updateMediaPermissions();
        };
    }
}

export const mediaUpdatedSubject = new Subject<void>();

export const cameras : Map<string, MediaDeviceInfo> = new Map();

export const microphones : Map<string, MediaDeviceInfo> = new Map();
export const speakers : Map<string, MediaDeviceInfo> = new Map();

let configAvailable = false;

export function useCameras(){
    const [cameraDevices, setCameraDevices] = useState<Map<string, MediaDeviceInfo>>(cameras);

    useEffect(() => {
        const sub = mediaUpdatedSubject.subscribe({
            next: () => {
                setCameraDevices(cameras);
            }
        });

        return () => {
            sub.unsubscribe();
        }
    }, []);


    return cameraDevices;
}

export function useMicrophones(){
    const [microphoneDevices, setMicrophoneDevices] = useState<Map<string, MediaDeviceInfo>>(microphones);

    useEffect(() => {
        const sub = mediaUpdatedSubject.subscribe({
            next: () => {
                setMicrophoneDevices(microphones);
            }
        });

        return () => {
            sub.unsubscribe();
        }
    }, []);

    return microphoneDevices;
}

export function useSpeakers(){
    const [speakerDevices, setSpeakerDevices] = useState<Map<string, MediaDeviceInfo>>(speakers);

    useEffect(() => {
        const sub = mediaUpdatedSubject.subscribe({
            next: () => {
                setSpeakerDevices(speakers);
            }
        });

        return () => {
            sub.unsubscribe();
        }
    }, []);

    return speakerDevices;
}

export function useConfigAvailable(){
    const [available, setAvailable] = useState<boolean>(configAvailable);

    useEffect(() => {
        const sub = mediaUpdatedSubject.subscribe({
            next: () => {
                setAvailable(configAvailable);
            }
        });

        return () => {
            sub.unsubscribe();
        }
    }, []);

    return available;
}

// Whether opening this device will put a permission prompt on the screen.
//
// A prompt belongs to the browser and the page cannot take it back down: it
// stands until somebody answers it. A call rings for thirty seconds, so a
// ring that opens a camera nobody has allowed yet leaves its prompt behind
// when the call is missed — still sitting there minutes later, offering a
// camera to a call that is long over. The ring therefore only opens what has
// already been allowed; anything that would ask waits until Answer is
// pressed, where the prompt is something the person just asked for.
export function mediaPreauthorized( kind: 'camera' | 'microphone' ): boolean {
    const state = mediaAccess.get( kind );

    if( state === 'granted' ) return true;
    if( state === 'denied' || state === 'prompt' ) return false;

    // Safari answers nothing at all when asked about these two, and reports
    // 'unknown' here. A device only carries a label once this origin has been
    // allowed to see it, so a labelled one is a permission already given.
    const devices = kind === 'camera' ? cameras : microphones;

    for( const device of devices.values() ){
        if( !! device.label ) return true;
    }

    return false;
}

export async function updateMediaPermissions() {
    try {
        //const supported = media.getSupportedConstraints()

        if (typeof media !== 'object' || typeof media.enumerateDevices !== 'function') {
            configAvailable = false;
            mediaAccess.set('camera', 'unknown');
            mediaAccess.set('microphone', 'unknown');
            mediaUpdatedSubject.next();
            return;
        }

        const [cameraState, microphoneState, devices] = await Promise.all([
            getPermissionState("camera"),
            getPermissionState("microphone"),
            media.enumerateDevices()
        ]);

        mediaAccess.set('camera', cameraState);
        mediaAccess.set('microphone', microphoneState);

        cameras.clear();
        microphones.clear();
        speakers.clear();

        devices.forEach((device) => {
            if (!!device.deviceId) {
                switch (device.kind) {
                    case "videoinput":
                        cameras.set(device.deviceId, device);
                        break;
                    case "audioinput":
                        microphones.set(device.deviceId, device);
                        break;
                    case "audiooutput":
                        speakers.set(device.deviceId, device);
                        break;
                }
            }
        });

        if (cameras.size > 0 || microphones.size > 0 || speakers.size > 0) {
            configAvailable = true;
        } else {
            configAvailable = false;
        }

        mediaUpdatedSubject.next();
    } finally {
        startChangeMonitor()
    }
}

updateMediaPermissions();

async function getPermissionState( name : string ) : Promise<string> {
    return new Promise(async function(resolve, reject) {
        try {
            navigator.permissions.query({
                name: name as PermissionName
            }).then((res) => {
                resolve(res.state);
            }).catch((err) => {
                resolve('unknown');
            });
        } catch (e){
            resolve('unknown');
        }
    });
}

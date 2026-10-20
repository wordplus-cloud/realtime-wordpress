import UAParser from "ua-parser-js";
import {compareVersions} from "compare-versions";

const parser = new UAParser();
const device = parser.getDevice();
const os = parser.getOS();
const browser = parser.getBrowser();
const engine = parser.getEngine();

// The browser and platform a call ran on, as short labels for the call
// record: "Chrome 152", "macOS 26". Never the user agent string itself.
export function browserLabel(){
    const name = browser.name ?? 'unknown';
    const major = ( browser.version ?? '' ).split( '.' )[0];

    return major ? name + ' ' + major : name;
}

export function platformLabel(){
    const name = os.name ?? 'unknown';
    const major = ( os.version ?? '' ).split( '.' )[0];

    return major ? name + ' ' + major : name;
}

export function isMobile(){
    // The admin Design preview renders the messenger in a 375px iframe on a
    // desktop, where the UA says "desktop" and the mobile layout would never
    // appear. PHP sets this only for that iframe. On a server (an app's first render) there is no window, and no device.
    if( typeof window !== 'undefined' && ( window as any ).Better_Messages?.forceMobileView === '1' ){
        return true;
    }

    if( device.type === 'mobile' || device.type === 'tablet' ){
        return true;
    }

    return false;
}


export function isNewSafari(){
    if( os.name === 'iOS' && os.version ){
        if( compareVersions(os.version, '17') >= 0 ) {
            return true;
        } else {
            return false;
        }
    }

    if( browser.name && browser.name.toLowerCase().includes('safari') ){
        return true;
    }

    return false;
}


export function isSafari(){
    if( isIOS() ){
        return true;
    }

    if( browser.name && browser.name.toLowerCase().includes('safari') ){
        return true;
    }

    return false;
}

export function isIOS(){
    if( os.name === 'iOS' ){
        return true;
    }

    return false;
}

export function isWindows(){
    if( os.name && os.name.toLowerCase() === 'windows' ){
        return true;
    }

    return false;
}

export function isMac(){
    if( os.name && os.name.toLowerCase() === 'mac os' ){
        return true;
    }

    return false;
}

export function isAndroid(){
    if( os.name && os.name.includes('Android') ){
        return true;
    }

    return false;
}

export function isFirefox(){
    if( browser.name && browser.name.toLowerCase() === 'firefox' ){
        return true;
    }

    return false;
}

export function isOldIOS(){
    if( os.name === 'iOS' && os.version ){
        if(  compareVersions(os.version, '14.5') === -1 ){
            return true;
        }
    } else if( os.name === 'Mac OS') {
        if( browser.name === 'Safari' && browser.version ){
            if(  compareVersions(browser.version, '14') === -1 ){
                return true;
            }
        }
    }

    return false;
}


import {_x, sprintf} from "./globals.ts";

// Why a camera or microphone would not open, in words the reader can act on.
// Denied, missing and busy each need a different answer, and a recorder that
// only says it could not open the device sends them looking in the wrong
// place.
//
// In the package's root entry, not /calls: Better Messages' voice and video
// message recorders need it too, and they are in its composer — in the main
// bundle, while `calls/permissions.ts` is in the lazy calls chunk and starts
// querying permissions and enumerating devices the moment it is imported.
export function getPermissionFailure(error: unknown, type : string | null = null ): string {
    console.error( error );
    if( ! type ) {
        type = _x( 'Camera or Microphone', 'Calling Features - Device Name when error triggered', 'bp-better-messages');
    }

    if (error && typeof error === 'object' && 'name' in error) {
        if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
            return sprintf(_x( '%s not found', 'Calling Features - Device not found error', 'bp-better-messages'), type);
        }
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            return sprintf(_x( 'No permission to access %s. Please ensure access to %s is allowed in your browser settings.', 'Calling Features - Device no permission error', 'bp-better-messages'), type.toLowerCase(), type.toLowerCase());
        }
        if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
            return sprintf(_x( '%s is already in use. Ensure that its not used by other application or select other %s if available.', 'Calling Features - Device already in use error', 'bp-better-messages'), type, type);
        }

        return sprintf( _x( 'Unknown error while trying to access %s', 'Calling Features - Device unknown error', 'bp-better-messages'), type.toLowerCase() )
    }

    return '';
}

import React, { isValidElement, type ReactNode } from "react";
import Tooltip from "../helpers/tooltip.tsx";
import Icon, { type IconName } from "../../primitives/icon.tsx";

export interface CallControlProps {
    /** What it does: its tooltip, its line in More, and what a screen reader says. */
    label: string;
    /** One of the package's icons by name, or the app's own. */
    icon: IconName | ReactNode;
    onClick: () => void;
    /** Latched on, as the microphone or the shared screen is. */
    active?: boolean;
    /** A class of the app's own, beside `bm-call-control`. */
    className?: string;
}

/**
 * A button of the app's own in a call's dock (the `controls` piece): drawn as ours are, so it sits in the row, folds
 * into More with the rest when the row is full, and takes the dock's look. Hook-free, so the dock may draw it itself.
 */
export default function CallControl( { label, icon, onClick, active, className }: CallControlProps ) {
    return <Tooltip content={ label }>
        <span onClick={ onClick } role="button" aria-label={ label } data-active={ active ? 1 : undefined }
              className={ "bm-call-control" + ( className ? " " + className : "" ) }>
            { typeof icon === "string" && ! isValidElement( icon ) ? <Icon name={ icon as IconName } size={ 20 } /> : icon }
        </span>
    </Tooltip>;
}

// Mac only: the front app, the app a session runs in, idle time and the
// locked screen. None of these ask for a permission (tested 9 Nov 2026,
// macOS 27.2, see the daily log).

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_app_kit::{
    NSApplicationActivationOptions, NSApplicationActivationPolicy, NSRunningApplication,
    NSWorkspace,
};

use crate::state::App;
use objc2_foundation::{NSDictionary, NSNumber, NSString};

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventSourceSecondsSinceLastEventType(state: i32, event_type: u32) -> f64;
    fn CGSessionCopyCurrentDictionary() -> *mut NSDictionary<NSString, AnyObject>;
    fn CGMainDisplayID() -> u32;
    fn CGDisplayIsAsleep(display: u32) -> u32;
}

// The front app's process id. Ask on the main thread: NSWorkspace updates it there.
pub fn front_app() -> Option<i32> {
    NSWorkspace::sharedWorkspace()
        .frontmostApplication()
        .map(|app| app.processIdentifier())
}

// The app with this process id, if it is a regular app (one with a Dock icon
// and windows, not a helper or a shell).
pub fn regular_app(pid: i32) -> Option<App> {
    let app = NSRunningApplication::runningApplicationWithProcessIdentifier(pid)?;
    if app.activationPolicy() != NSApplicationActivationPolicy::Regular {
        return None;
    }
    let name = app
        .localizedName()
        .map(|s| s.to_string())
        .unwrap_or_default();
    Some(App { pid, name })
}

// Seconds since the last mouse or keyboard input, from anyone on this Mac.
pub fn idle_seconds() -> f64 {
    // kCGEventSourceStateCombinedSessionState = 0, kCGAnyInputEventType = ~0.
    unsafe { CGEventSourceSecondsSinceLastEventType(0, !0) }
}

// None when macOS gives no answer (for example no one logged in on screen).
pub fn screen_locked() -> Option<bool> {
    let raw = unsafe { CGSessionCopyCurrentDictionary() };
    // A "Copy" function: we own the dictionary, and Retained releases it.
    let dict: Retained<NSDictionary<NSString, AnyObject>> = unsafe { Retained::from_raw(raw)? };
    // Its value, not only whether it is there (code review 9 Nov): absent or
    // false is unlocked. Anything but a number counts as locked, as before.
    let value = dict.objectForKey(&NSString::from_str("CGSSessionScreenIsLocked"));
    Some(value.is_some_and(|v| v.downcast_ref::<NSNumber>().is_none_or(|n| n.boolValue())))
}

// True when the main display has gone to sleep (the user is away).
pub fn display_asleep() -> bool {
    unsafe { CGDisplayIsAsleep(CGMainDisplayID()) != 0 }
}

// Brings the app with this process id to the front. False if macOS said no.
pub fn bring_forward(pid: i32) -> bool {
    NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
        .is_some_and(|app| app.activateWithOptions(NSApplicationActivationOptions::empty()))
}

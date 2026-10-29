use std::fs;
use std::path::Path;

fn main() {
    // character/sprout.js is the one true copy; the window can only load files
    // from app/src, so copy it there before the page is bundled. The copy is
    // git-ignored. Only rewritten when it differs, so it never triggers a rebuild loop.
    let src = Path::new("../../character/sprout.js");
    let dst = Path::new("../src/sprout.js");
    println!("cargo:rerun-if-changed={}", src.display());
    let code = fs::read(src).expect("read character/sprout.js");
    if fs::read(dst).ok().as_deref() != Some(code.as_slice()) {
        fs::write(dst, code).expect("copy sprout.js into app/src");
    }

    tauri_build::build()
}

// Copyright (c) 2026 Mohamed. All rights reserved. See LICENSE.
// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    blip_lib::run()
}

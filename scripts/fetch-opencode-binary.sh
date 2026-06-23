#!/bin/bash
# scripts/fetch-opencode-binary.sh
# Compiles the mock opencode sidecar and copies it to tauri/binaries/

echo "Building mock opencode binary..."
cargo build --package aurora-sidecar --bin mock_opencode

TARGET_DIR="tauri/binaries"
mkdir -p "$TARGET_DIR"

OS_TYPE="$(uname -s)"
ARCH_TYPE="$(uname -m)"

case "$OS_TYPE" in
    Linux*)     TRIPLE="x86_64-unknown-linux-gnu";;
    Darwin*)    
        if [ "$ARCH_TYPE" = "arm64" ]; then
            TRIPLE="aarch64-apple-darwin"
        else
            TRIPLE="x86_64-apple-darwin"
        fi
        ;;
    CYGWIN*|MINGW32*|MSYS*|MINGW*)
        TRIPLE="x86_64-pc-windows-msvc"
        ;;
    *)          TRIPLE="x86_64-pc-windows-msvc" # Default fallback
esac

echo "Target triple: $TRIPLE"

if [ "$TRIPLE" = "x86_64-pc-windows-msvc" ]; then
    if [ -f target/debug/mock_opencode.exe ]; then
        cp target/debug/mock_opencode.exe "$TARGET_DIR/opencode-$TRIPLE.exe"
    elif [ -f target/debug/mock_opencode ]; then
        cp target/debug/mock_opencode "$TARGET_DIR/opencode-$TRIPLE.exe"
    fi
else
    cp target/debug/mock_opencode "$TARGET_DIR/opencode-$TRIPLE"
fi

echo "Copied mock_opencode to $TARGET_DIR/opencode-$TRIPLE"
echo "Done!"

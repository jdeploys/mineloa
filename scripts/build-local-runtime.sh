#!/usr/bin/env bash
set -euo pipefail

WHISPER_TAG='v1.9.1'
FFMPEG_TAG='n8.1.2'
WHISPER_COMMIT='f049fff95a089aa9969deb009cdd4892b3e74916'
FFMPEG_COMMIT='38b88335f99e76ed89ff3c93f877fdefce736c13'
FFMPEG_FLAGS=(
  # Without this, configure links whatever it finds on the build machine — a
  # developer Mac with Homebrew produces an ffmpeg that will not load inside
  # the signed app, while a clean CI runner produces a self-contained one.
  --disable-autodetect
  --disable-gpl --disable-nonfree --disable-doc --disable-network
  --disable-ffplay --disable-ffprobe --disable-everything --enable-ffmpeg
  --enable-protocol=file --enable-demuxer=matroska --enable-decoder=opus
  --enable-filter=aresample --enable-encoder=pcm_s16le --enable-muxer=wav
  --enable-avformat --enable-avcodec --enable-avfilter --enable-swresample
)

repo_root="$(cd "$(dirname "$0")/.." && pwd -P)"
case "$(uname -s)" in Darwin) platform='darwin' ;; *) echo 'macOS is required' >&2; exit 1 ;; esac
case "${1:-$(uname -m)}" in x64|x86_64) arch='x64' ;; arm64|aarch64) arch='arm64' ;; *) echo 'unsupported architecture' >&2; exit 1 ;; esac
native_arch="$(uname -m)"
if [[ "$arch" == x64 && "$native_arch" != x86_64 ]] || [[ "$arch" == arm64 && "$native_arch" != arm64 ]]; then
  echo 'cross-compilation is not supported; use the matching native runner' >&2
  exit 1
fi

runtime_root="$repo_root/build/local-runtime"
build_root="$runtime_root/.work/$platform-$arch"
output="$runtime_root/$platform-$arch"
case "$build_root" in "$runtime_root"/*) ;; *) exit 1 ;; esac
case "$output" in "$runtime_root"/*) ;; *) exit 1 ;; esac
rm -rf -- "$build_root" "$output"
mkdir -p -- "$build_root" "$output"
cleanup() { rm -rf -- "$build_root"; }
fail() { rm -rf -- "$output"; cleanup; }
trap fail ERR

git -C "$build_root" clone --depth 1 --branch "$WHISPER_TAG" --single-branch https://github.com/ggml-org/whisper.cpp.git whisper.cpp
[[ "$(git -C "$build_root/whisper.cpp" describe --exact-match --tags HEAD)" == "$WHISPER_TAG" ]]
[[ "$(git -C "$build_root/whisper.cpp" rev-parse 'HEAD^{commit}')" == "$WHISPER_COMMIT" ]]
cmake -S "$build_root/whisper.cpp" -B "$build_root/whisper.cpp/build" -DGGML_NATIVE=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON -DBUILD_SHARED_LIBS=OFF
cmake --build "$build_root/whisper.cpp/build" --config Release --target whisper-cli --parallel

git -C "$build_root" clone --depth 1 --branch "$FFMPEG_TAG" --single-branch https://github.com/FFmpeg/FFmpeg.git ffmpeg
[[ "$(git -C "$build_root/ffmpeg" describe --exact-match --tags HEAD)" == "$FFMPEG_TAG" ]]
[[ "$(git -C "$build_root/ffmpeg" rev-parse 'HEAD^{commit}')" == "$FFMPEG_COMMIT" ]]
(cd "$build_root/ffmpeg" && ./configure "${FFMPEG_FLAGS[@]}" && make -j"$(sysctl -n hw.logicalcpu)" ffmpeg)

cp -- "$build_root/whisper.cpp/build/bin/whisper-cli" "$output/whisper-cli"
cp -- "$build_root/ffmpeg/ffmpeg" "$output/ffmpeg"
cp -- "$build_root/whisper.cpp/LICENSE" "$output/LICENSE.whisper.cpp"
cp -- "$build_root/ffmpeg/COPYING.LGPLv2.1" "$output/LICENSE.FFmpeg"
cp -- "$runtime_root/THIRD_PARTY_NOTICES.md" "$output/THIRD_PARTY_NOTICES.md"
chmod 0755 "$output/whisper-cli" "$output/ffmpeg"
node "$repo_root/scripts/write-local-runtime-manifest.mjs" "$output" "$platform" "$arch"
trap - ERR
cleanup

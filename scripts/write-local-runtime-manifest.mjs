import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

function owned(root, candidate) {
  const fromRoot = relative(root, candidate)
  return fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot)
}

function sameFile(left, right) {
  const sameDevice = left.dev === right.dev
    || (process.platform === 'win32' && (left.dev === 0 || right.dev === 0))
  return sameDevice && left.ino === right.ino
}

async function inspectOwnedFile(root, name, executable) {
  if (basename(name) !== name) throw new Error('Invalid local runtime component')
  const candidate = join(root, name)
  const pathDetails = await lstat(candidate)
  const canonical = await realpath(candidate)
  if (!pathDetails.isFile() || pathDetails.isSymbolicLink() || !owned(root, canonical)) {
    throw new Error(`Invalid local runtime component: ${name}`)
  }
  const handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || !sameFile(pathDetails, opened)) throw new Error(`Invalid local runtime component: ${name}`)
    if (process.platform === 'darwin' && executable && (opened.mode & 0o111) === 0) {
      throw new Error(`Local runtime component is not executable: ${name}`)
    }
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    let offset = 0
    while (offset < opened.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, opened.size - offset), offset)
      if (bytesRead === 0) throw new Error(`Unexpected EOF: ${name}`)
      hash.update(buffer.subarray(0, bytesRead))
      offset += bytesRead
    }
    return { size: opened.size, sha256: hash.digest('hex') }
  } finally {
    await handle.close()
  }
}

async function existingOwnedManifest(root, path) {
  const pathDetails = await lstat(path)
  const canonical = await realpath(path)
  if (!pathDetails.isFile() || pathDetails.isSymbolicLink() || !owned(root, canonical)) {
    throw new Error('Refusing to replace an invalid runtime manifest')
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || !sameFile(pathDetails, opened)) throw new Error('Refusing to replace an invalid runtime manifest')
    return { dev: opened.dev, ino: opened.ino }
  } finally {
    await handle.close()
  }
}

async function replaceOwnedManifest(root, manifestPath, contents) {
  const expected = await existingOwnedManifest(root, manifestPath)
  const temporary = join(root, `.runtime-manifest-${randomUUID()}.tmp`)
  let temporaryExists = false
  try {
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    temporaryExists = true
    try {
      await handle.writeFile(contents, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    const current = await existingOwnedManifest(root, manifestPath)
    if (!sameFile(expected, current)) throw new Error('Runtime manifest changed before atomic replacement')
    await rename(temporary, manifestPath)
    temporaryExists = false
  } finally {
    if (temporaryExists) await unlink(temporary).catch(() => undefined)
  }
}

export async function writeRuntimeManifest({ directory, platform, arch, replaceExisting = false }) {
  const target = `${platform}-${arch}`
  if (!directory || !['win32-x64', 'darwin-x64', 'darwin-arm64'].includes(target)) {
    throw new Error('Unsupported local runtime manifest target')
  }
  const requestedRoot = resolve(directory)
  const root = await realpath(requestedRoot)
  if (root !== requestedRoot) throw new Error('Local runtime output must not be linked')

  const executableNames = platform === 'win32' ? ['whisper-cli.exe', 'ffmpeg.exe'] : ['whisper-cli', 'ffmpeg']
  const names = [...executableNames, 'THIRD_PARTY_NOTICES.md', 'LICENSE.whisper.cpp', 'LICENSE.FFmpeg']
  const files = {}
  for (const name of names) files[name] = await inspectOwnedFile(root, name, executableNames.includes(name))

  const contents = `${JSON.stringify({
    schemaVersion: 1,
    platform,
    arch,
    whisperCpp: 'v1.9.1',
    whisperCppCommit: 'f049fff95a089aa9969deb009cdd4892b3e74916',
    ffmpeg: 'n8.1.2',
    ffmpegCommit: '1c2c67c0b9f7f66ab32c19dcf7f227bcd290aa4c',
    files,
  }, null, 2)}\n`
  const manifestPath = join(root, 'runtime-manifest.json')
  if (replaceExisting) await replaceOwnedManifest(root, manifestPath, contents)
  else {
    const handle = await open(manifestPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try {
      await handle.writeFile(contents, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
  }
}

const invokedPath = process.argv[1] === undefined ? null : resolve(process.argv[1])
if (invokedPath === fileURLToPath(import.meta.url)) {
  const [, , directory, platform, arch, mode] = process.argv
  await writeRuntimeManifest({ directory, platform, arch, replaceExisting: mode === '--replace-owned' })
}

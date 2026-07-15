from pathlib import Path
import math
import struct
import wave

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "build" / "icons"
FIXTURE_DIR = ROOT / "tests" / "e2e" / "fixtures"
ICON_DIR.mkdir(parents=True, exist_ok=True)
FIXTURE_DIR.mkdir(parents=True, exist_ok=True)

size = 1024
image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
surface = Image.new("RGBA", (size, size), (0, 0, 0, 0))
surface_draw = ImageDraw.Draw(surface)
for y in range(48, 976):
    t = (y - 48) / 928
    color = tuple(round(a + (b - a) * t) for a, b in zip((29, 78, 216), (49, 46, 129))) + (255,)
    surface_draw.line((48, y, 976, y), fill=color)
mask = Image.new("L", (size, size), 0)
ImageDraw.Draw(mask).rounded_rectangle((48, 48, 976, 976), radius=224, fill=255)
image.paste(surface, mask=mask)
draw = ImageDraw.Draw(image)
draw.polygon([(280, 718), (280, 306), (380, 306), (644, 580), (644, 306), (744, 306), (744, 718), (644, 718), (380, 444), (380, 718)], fill="white")
draw.ellipse((690, 692, 798, 800), fill=(103, 232, 249, 255))

image.save(ICON_DIR / "icon.png")
image.save(ICON_DIR / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
image.save(ICON_DIR / "icon.icns", sizes=[(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512), (1024, 1024)])

sample_rate = 48_000
duration_seconds = 3
with wave.open(str(FIXTURE_DIR / "fake-audio.wav"), "wb") as output:
    output.setnchannels(1)
    output.setsampwidth(2)
    output.setframerate(sample_rate)
    frames = bytearray()
    for index in range(sample_rate * duration_seconds):
        sample = int(3_000 * math.sin(2 * math.pi * 440 * index / sample_rate))
        frames.extend(struct.pack("<h", sample))
    output.writeframes(frames)

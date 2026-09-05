from pathlib import Path

from PIL import Image


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE = PROJECT_ROOT / "assets" / "lw-aiusage-icon.png"
TARGET = PROJECT_ROOT / "assets" / "lw-aiusage-icon.ico"
SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def main() -> None:
    with Image.open(SOURCE) as image:
        image.convert("RGBA").save(TARGET, format="ICO", sizes=SIZES)
    print(TARGET)


if __name__ == "__main__":
    main()

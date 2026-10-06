#!/bin/bash
# usage: shot.sh <serial> <name>  → /tmp/ebook-spike/shots/<name>.jpg (≤1000 px high)
export PATH=$PATH:~/Library/Android/sdk/platform-tools
adb -s "$1" exec-out screencap -p > /tmp/ebook-spike/shots/$2.png && sips -s format jpeg -s formatOptions 80 -Z 1000 /tmp/ebook-spike/shots/$2.png --out /tmp/ebook-spike/shots/$2.jpg >/dev/null && rm /tmp/ebook-spike/shots/$2.png && echo /tmp/ebook-spike/shots/$2.jpg

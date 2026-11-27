# Video Editing with Claude Code: Tool Stack

Eight open-source repos for a Claude Code video-editing workflow:
script, cut, captions, motion, 3D, export.

| Repo | What it does | Stars |
|---|---|---|
| [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes) | Write the edit in HTML, get an MP4 back | 88.3k |
| [greensock/GSAP](https://github.com/greensock/GSAP) | Every pop, slide and zoom on screen (motion) | 31.1k |
| [mrdoob/three.js](https://github.com/mrdoob/three.js) | 3D shots straight from a web page | 119.2k |
| [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper) | Word-level captions from your voice | 27k |
| [FFmpeg/FFmpeg](https://github.com/FFmpeg/FFmpeg) | Cuts, audio, color and the final MP4 | 68k |
| [yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp) | Pulls reference videos for study | 210k |
| [microsoft/playwright](https://github.com/microsoft/playwright) | Screenshots real websites for b-roll | 100.8k |
| [python-pillow/Pillow](https://github.com/python-pillow/Pillow) | Thumbnails and frames | 14k |

> URLs were typed from usernames in a screenshot. Verify them before installing
> (especially hyperframes, whose org may differ).

## Install (Windows, PowerShell)

```powershell
# System tools
winget install Gyan.FFmpeg
winget install Python.Python.3.12
winget install OpenJS.NodeJS.LTS

# Python libs
pip install faster-whisper yt-dlp Pillow playwright
playwright install chromium

# JS libs (run inside your video project folder)
npm init -y
npm install gsap three
```

Restart the terminal afterwards so `ffmpeg` is on your PATH.

## Install (macOS / Linux)

```bash
brew install ffmpeg python node        # Linux: sudo apt install ffmpeg python3-pip nodejs npm
pip install faster-whisper yt-dlp Pillow playwright
playwright install chromium
npm init -y && npm install gsap three
```

## HyperFrames

Not covered above: follow the install section of its README
(`github.com/heygen-com/hyperframes`).

## Verify

```
ffmpeg -version
yt-dlp --version
python -c "import faster_whisper, PIL, playwright; print('ok')"
node -e "require('gsap'); require('three'); console.log('ok')"
```

## Checklist

- [ ] ffmpeg
- [ ] yt-dlp
- [ ] faster-whisper
- [ ] Pillow
- [ ] playwright (+ chromium)
- [ ] gsap
- [ ] three.js
- [ ] hyperframes

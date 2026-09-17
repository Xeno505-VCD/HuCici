# HuCici

HuCici is a single interactive archive for ten 3D holographic and lenticular cards. The public repository contains one gallery entry point and only the runtime assets required by that gallery.

## Public gallery

<https://xeno505-vcd.github.io/HuCici/>

## Controls

- Drag a card to inspect its 3D depth and foil response.
- Use the frosted-glass side arrows to move between cards.
- The full progress screen appears only on the first view. Later cards load behind the visible card, and the previous card is retained for an immediate return.

## Local preview

Serve the repository as a static site instead of opening `index.html` directly:

```powershell
python -m http.server 4175 --bind 127.0.0.1
```

Then open <http://127.0.0.1:4175/>.

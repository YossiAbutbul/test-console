"""Formatted words in a report: bold and colour on selected words.

Any word on a report page can carry formatting -- a block's text, a label,
a table cell. It is kept inside the value itself, as a few HTML tags the
page writes and nothing else:

    <b>..</b>                          bold
    <i>..</i>                          italic
    <u>..</u>                          underlined
    <span style="font-weight:400">..   not bold (in a heading, say)
    <span style="color:#RRGGBB">..     a colour (both may share one span)

with &amp; &lt; &gt; &quot; for the characters the tags use. A value with
none of those tags is plain text and is read as written, so values saved
before formatting existed -- "< 30 ppm" included -- read as they always did.
The page's twin is frontend/src/tests/reports/rich.ts.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from html import unescape
from typing import Optional

_RICH = re.compile(r"<[biu]>|<span style=\"[^\"]*\">")
_TOKEN = re.compile(r"<[biu]>|</[biu]>|<span style=\"([^\"]*)\">|</span>|[^<]+|<")
_HEX = re.compile(r"#?([0-9a-fA-F]{6})")


@dataclass(frozen=True)
class Span:
    text: str
    #: True bold, False explicitly not bold, None the place's own weight.
    bold: Optional[bool] = None
    #: "RRGGBB", or None for the place's own colour.
    color: Optional[str] = None
    italic: bool = False
    underline: bool = False

    def look(self) -> tuple:
        return (self.bold, self.color, self.italic, self.underline)

    def with_text(self, text: str) -> "Span":
        return Span(text, self.bold, self.color, self.italic, self.underline)


def is_rich(value: str) -> bool:
    return bool(_RICH.search(value or ""))


def _style(style: str) -> tuple[Optional[bool], Optional[str]]:
    bold: Optional[bool] = None
    color: Optional[str] = None
    for part in style.split(";"):
        if ":" not in part:
            continue
        k, v = (x.strip().lower() for x in part.split(":", 1))
        if k == "color":
            m = _HEX.fullmatch(v)
            if m:
                color = m.group(1).upper()
        elif k == "font-weight":
            bold = v in ("bold", "700", "600", "800", "900")
    return bold, color


def spans(value: str) -> list[Span]:
    """The value as runs of equal formatting."""
    if not value:
        return []
    if not is_rich(value):
        return [Span(value)]
    out: list[Span] = []
    # The open tags, innermost last: what each says about bold and colour.
    stack: list[tuple[str, Optional[bool], Optional[str]]] = []
    for m in _TOKEN.finditer(value):
        tok = m.group(0)
        if tok in ("<b>", "<i>", "<u>"):
            stack.append((tok[1], True if tok == "<b>" else None, None))
        elif tok.startswith("<span "):
            b, c = _style(m.group(1) or "")
            stack.append(("span", b, c))
        elif tok.startswith("</") and len(tok) > 2:
            want = tok[2:-1]
            for i in range(len(stack) - 1, -1, -1):
                if stack[i][0] == want:
                    del stack[i]
                    break
        else:
            bold: Optional[bool] = None
            color: Optional[str] = None
            for _, b, c in stack:
                bold = b if b is not None else bold
                color = c if c is not None else color
            tags = {t for t, _, _ in stack}
            s = Span(unescape(tok), bold, color, "i" in tags, "u" in tags)
            if out and out[-1].look() == s.look():
                out[-1] = out[-1].with_text(out[-1].text + s.text)
            else:
                out.append(s)
    return out


def plain(value: str) -> str:
    """The words alone, formatting dropped."""
    return "".join(s.text for s in spans(value))


def split(runs: list[Span], sep: str) -> list[list[Span]]:
    """Runs cut into pieces at `sep` (a line, a paragraph), formatting kept
    on both sides of every cut."""
    out: list[list[Span]] = [[]]
    for s in runs:
        parts = s.text.split(sep)
        for i, part in enumerate(parts):
            if i:
                out.append([])
            if part:
                out[-1].append(s.with_text(part))
    return out


def strip(runs: list[Span]) -> list[Span]:
    """Leading and trailing white space removed, as str.strip does."""
    runs = [s for s in runs if s.text]
    while runs and not runs[0].text.strip():
        runs = runs[1:]
    while runs and not runs[-1].text.strip():
        runs = runs[:-1]
    if not runs:
        return []
    runs[0] = runs[0].with_text(runs[0].text.lstrip())
    runs[-1] = runs[-1].with_text(runs[-1].text.rstrip())
    return runs

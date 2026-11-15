"""A product report: the runs an operator chose to keep for one product model.

An entry is deliberately generic -- a titled table with the run's settings and
the unit it came from -- so every test feeds the same report without the
report knowing any test's internals. The columns and rows are the ones that
test already exports as CSV (each page's `CSV_HEADER` / `toCsvBody`), so a
report and an export of the same run read alike.
"""

from __future__ import annotations

from typing import Literal, Optional, Union

from pydantic import BaseModel, Field

Cell = Union[str, float, int, bool, None]


class EntryDut(BaseModel):
    """The unit a run was measured on, as the page knew it."""

    mac: Optional[str] = None
    #: The advertised BLE name, the nearest thing to a device type on the wire.
    name: Optional[str] = None
    #: The operator's label for this MAC (Nicknames).
    nickname: Optional[str] = None


class EntryIn(BaseModel):
    #: Which test, as a slug ("tx-cw-automation", "frequency-accuracy", ...).
    test: str = Field(..., min_length=1, max_length=80)
    #: Heading in the report, e.g. "LoRa CW automation".
    title: str = Field(..., min_length=1, max_length=200)
    note: str = Field(default="", max_length=4000)
    operator: str = Field(default="", max_length=200)
    dut: EntryDut = EntryDut()
    #: Run-wide settings worth reading beside the table: settle, stages, ...
    settings: list[tuple[str, str]] = Field(default_factory=list, max_length=100)
    columns: list[str] = Field(..., min_length=1, max_length=60)
    rows: list[list[Cell]] = Field(default_factory=list, max_length=20_000)


class EntrySummary(BaseModel):
    points: int = 0
    passed: int = 0
    failed: int = 0

    @property
    def result(self) -> str:
        """"Fail" if any point failed, "Pass" if any was judged and none
        failed, otherwise "-" (measured, not judged)."""
        if self.failed:
            return "Fail"
        return "Pass" if self.passed else "-"


class Entry(EntryIn):
    id: str
    added_at: str
    summary: EntrySummary = EntrySummary()


BlockType = Literal[
    "cover", "heading", "text", "summary", "entry", "all_entries", "page_break", "image", "params", "units",
    "chart",
]


class Block(BaseModel):
    """One component of a report's layout, in document order.

    - cover: the title page facts (product, period, units, operators, notes)
    - heading / text: the operator's own words
    - summary: one row per run with its result
    - entry: one run, by id, with its settings and table
    - all_entries: every run not placed by an entry block, in the order
      added -- what a template carries in place of runs it cannot know
    - page_break
    - image: a picture by id (see ReportStore.save_image), `width` percent of
      the text width, `text` its caption
    - params: a Parameter / Value table the operator fills in (`rows`)
    - units: the units the runs were measured on, one per line
    - chart: a run's results plotted (`entry_id`; columns `x` and `ys`;
      `kind`; `text` its title). The page draws it; Word gets a Word chart of
      the same numbers (chart_docx.py).

    `labels` overrides the fixed words a block prints -- the cover's
    subtitle and field names, "Summary", "Settings", "Results", a run's
    title -- by key; a key not given prints the default. `fill:<table>:<row>`
    (`fill:<table>_h` its header) is a table row's fill, "#RRGGBB". Any text
    -- `text`, a label, a params cell -- may carry bold and colour on some of
    its words (rich.py).
    """

    id: str = Field(..., min_length=1, max_length=40)
    type: BlockType
    text: str = Field(default="", max_length=20_000)
    #: Heading level, 1 (section) or 2 (sub-section).
    level: int = Field(default=1, ge=1, le=2)
    entry_id: Optional[str] = None
    show_settings: bool = True
    show_note: bool = True
    image_id: Optional[str] = Field(default=None, max_length=40)
    width: int = Field(default=100, ge=10, le=100)
    #: Room for every cell of a long results table, each edited.
    labels: dict[str, str] = Field(default_factory=dict, max_length=20_000)
    #: params: the table's rows, [parameter, value].
    rows: list[list[str]] = Field(default_factory=list, max_length=200)
    #: chart: the run's column on the X axis, those plotted, and how.
    x: int = Field(default=0, ge=0, le=100)
    ys: list[int] = Field(default_factory=list, max_length=12)
    kind: Literal["line", "bar", "scatter"] = "line"


def default_blocks() -> list["Block"]:
    """A new report's layout: the lab's RF report -- cover, test setup,
    scope, test parameters and unit IDs -- then the results and notes.
    Ids are per report, so fixed ones are enough here."""
    def h(i: str, text: str, level: int = 1) -> Block:
        return Block(id=i, type="heading", text=text, level=level)
    return [
        Block(id="cover", type="cover", width=60),
        h("h-setup", "Test Setup:"),
        Block(id="setup-pic", type="image"),
        h("h-scope", "Scope of Testing"),
        Block(id="scope", type="text"),
        h("h-params", "Test Parameters:"),
        h("h-measure", "Measurement Parameters:", 2),
        Block(id="params", type="params", rows=[["Frequency", ""], ["Tested Power", ""]]),
        h("h-units", "Unit IDs:", 2),
        Block(id="units", type="units"),
        Block(id="pb-results", type="page_break"),
        h("h-results", "Results"),
        Block(id="summary", type="summary"),
        Block(id="runs", type="all_entries"),
        Block(id="pb-notes", type="page_break"),
        h("h-notes", "Notes:"),
        Block(id="notes", type="text"),
    ]


class ReportStyle(BaseModel):
    """How every report looks, beyond its layout: the logo on the cover and
    in the header. Kept with the reports, not in the code: it is the lab's
    branding, and the repository is public."""

    logo_image_id: Optional[str] = Field(default=None, max_length=40)


class ProductIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    notes: str = Field(default="", max_length=4000)
    #: Start from this template's layout instead of the default.
    template_id: Optional[str] = None


class BlocksIn(BaseModel):
    blocks: list[Block] = Field(..., max_length=500)


class TemplateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    blocks: list[Block] = Field(..., max_length=500)


class Template(TemplateIn):
    id: str
    created_at: str


class ApplyTemplate(BaseModel):
    template_id: str


class ProductPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    notes: Optional[str] = Field(default=None, max_length=4000)


class Product(BaseModel):
    id: str
    name: str
    notes: str = ""
    created_at: str
    updated_at: str
    entries: list[Entry] = Field(default_factory=list)
    #: The report's layout. Reports from before layouts were editable have
    #: none, and print as default_blocks() until first edited.
    blocks: list[Block] = Field(default_factory=default_blocks)


class ProductListItem(BaseModel):
    id: str
    name: str
    notes: str
    created_at: str
    updated_at: str
    entry_count: int
    #: Units with at least one entry, by MAC.
    units: int


class EntryOrder(BaseModel):
    ids: list[str]

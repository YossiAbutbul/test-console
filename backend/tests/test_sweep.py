"""Sweep plan validation and Excel export."""

from __future__ import annotations

from io import BytesIO

import pytest
from openpyxl import load_workbook

from backend.sweep.export import HEADERS, build_workbook, parse_workbook
from backend.sweep.models import ResultRow, SweepConfig


def col(name: str) -> int:
    """1-based column index of a header, so tests survive column insertions."""
    return HEADERS.index(name) + 1


def make_row(idx: int, *, measured: float | None, hp: int = 1, duty: int = 1) -> ResultRow:
    return ResultRow(
        idx=idx,
        freq_hz=902_300_000,
        power_dbm_setting=14,
        pa_duty_cycle=duty,
        hp_max=hp,
        tx_power_dbm=measured,
        current_a=0.1234,
        voltage_v=3.6,
        tx_hex="",
        rx_hex="",
        ok=True,
        status=0,
        t_ms=0,
    )


class TestSweepConfig:
    def test_total_steps_is_the_cartesian_product(self) -> None:
        config = SweepConfig(
            freq_hz=902_300_000,
            power_values=[1, 2, 3],
            duty_values=[1, 2],
            hp_values=[1, 2, 3, 4],
        )
        assert config.total_steps == 24

    def test_defaults_cover_the_full_spec_ranges(self) -> None:
        # 22 powers x 4 duty cycles x 7 hp values — all 1-based, no zero.
        assert SweepConfig(freq_hz=902_300_000).total_steps == 22 * 4 * 7 == 616

    def test_path_loss_defaults_to_no_correction(self) -> None:
        assert SweepConfig(freq_hz=902_300_000).path_loss_db == 0.0

    @pytest.mark.parametrize(
        ("kwargs", "match"),
        [
            ({"power_values": [0]}, "Power out of range"),
            ({"power_values": [23]}, "Power out of range"),
            # Zero hangs the DUT rather than being refused by it, so it has to
            # be stopped here — on all three axes.
            ({"duty_values": [0]}, "PaDutyCycle out of range"),
            ({"duty_values": [5]}, "PaDutyCycle out of range"),
            ({"hp_values": [0]}, "HpMax out of range"),
            ({"hp_values": [8]}, "HpMax out of range"),
        ],
    )
    def test_validate_ranges_rejects_values_the_dut_would_refuse(
        self, kwargs: dict, match: str
    ) -> None:
        config = SweepConfig(freq_hz=902_300_000, **kwargs)
        with pytest.raises(ValueError, match=match):
            config.validate_ranges()

    def test_validate_ranges_accepts_the_boundaries(self) -> None:
        SweepConfig(
            freq_hz=0, power_values=[1, 22], duty_values=[1, 4], hp_values=[1, 7]
        ).validate_ranges()

    def test_the_defaults_never_contain_a_zero(self) -> None:
        cfg = SweepConfig(freq_hz=902_300_000)
        assert 0 not in cfg.power_values
        assert 0 not in cfg.duty_values
        assert 0 not in cfg.hp_values


class TestBuildWorkbook:
    def test_all_sheet_holds_every_row_in_sweep_order(self) -> None:
        rows = [make_row(i, measured=10.0 + i) for i in range(3)]
        wb = load_workbook(BytesIO(build_workbook(rows)))

        assert wb.sheetnames[0] == "All"
        sheet = wb["All"]
        assert [c.value for c in sheet[1]] == HEADERS
        assert sheet.max_row == len(rows) + 1

    def test_one_sheet_per_measured_power_bucket_highest_first(self) -> None:
        rows = [
            make_row(0, measured=20.4),   # rounds to 20
            make_row(1, measured=19.6),   # rounds to 20
            make_row(2, measured=14.0),
        ]
        wb = load_workbook(BytesIO(build_workbook(rows)))

        assert wb.sheetnames == ["All", "20 dBm", "14 dBm"]
        assert wb["20 dBm"].max_row == 3

    def test_bucket_rows_run_from_closest_to_nominal_outwards(self) -> None:
        rows = [make_row(0, measured=20.4), make_row(1, measured=20.1)]
        wb = load_workbook(BytesIO(build_workbook(rows)))

        measured_column = [wb["20 dBm"].cell(row=r, column=5).value for r in (2, 3)]
        assert measured_column == [20.1, 20.4]

    def test_unmeasured_and_under_range_rows_get_no_bucket(self) -> None:
        rows = [
            make_row(0, measured=None),
            make_row(1, measured=-90.0),   # sensor under-range sentinel
            make_row(2, measured=14.0),
        ]
        wb = load_workbook(BytesIO(build_workbook(rows)))

        assert wb.sheetnames == ["All", "14 dBm"]
        # They are still present in All — the run happened, it just didn't read.
        assert wb["All"].max_row == 4

    def test_current_is_exported_in_milliamps(self) -> None:
        wb = load_workbook(BytesIO(build_workbook([make_row(0, measured=14.0)])))
        assert wb["All"].cell(row=2, column=col("CC [mA]")).value == 123.4

    def test_supply_voltage_is_exported_beside_the_current(self) -> None:
        wb = load_workbook(BytesIO(build_workbook([make_row(0, measured=14.0)])))
        assert wb["All"].cell(row=2, column=col("V [V]")).value == 3.6

    def test_a_row_with_no_voltage_leaves_the_cell_empty(self) -> None:
        r = make_row(0, measured=14.0)
        r.voltage_v = None
        wb = load_workbook(BytesIO(build_workbook([r])))
        assert wb["All"].cell(row=2, column=col("V [V]")).value is None

    def test_hp_and_duty_are_exported_as_hex_bytes(self) -> None:
        wb = load_workbook(BytesIO(build_workbook([make_row(0, measured=14.0, hp=7, duty=3)])))
        sheet = wb["All"]
        assert sheet.cell(row=2, column=col("HP Max")).value == "0x07"
        assert sheet.cell(row=2, column=col("PA DC")).value == "0x03"

    def test_the_number_column_is_the_sweep_index_in_every_sheet(self) -> None:
        """A bucket sheet reorders its rows, so a per-sheet counter could not be
        matched back to the All sheet or to the app's table."""
        rows = [
            make_row(0, measured=14.4),   # bucket 14, 0.4 away
            make_row(1, measured=3.0),    # bucket 3
            make_row(2, measured=14.1),   # bucket 14, 0.1 away — sorts first
        ]
        wb = load_workbook(BytesIO(build_workbook(rows)))

        assert [r[col("#") - 1].value for r in wb["All"].iter_rows(min_row=2)] == [1, 2, 3]
        # Bucket 14 holds rows 0 and 2, closest-to-nominal first — but they keep
        # their sweep numbers rather than being renumbered 1, 2.
        assert [r[col("#") - 1].value for r in wb["14 dBm"].iter_rows(min_row=2)] == [3, 1]

    def test_raw_reading_is_exported_so_a_wrong_path_loss_can_be_undone(self) -> None:
        r = make_row(0, measured=34.5)
        r.tx_power_dbm_raw = 14.0
        wb = load_workbook(BytesIO(build_workbook([r])))
        sheet = wb["All"]
        assert sheet.cell(row=2, column=col("Measured [dBm]")).value == 34.5
        assert sheet.cell(row=2, column=col("Raw [dBm]")).value == 14.0

    def test_a_failed_row_says_why_in_the_file(self) -> None:
        r = make_row(0, measured=None)
        r.current_a = None
        r.ok = False
        r.error = "DUT rejected the command (status=255)"
        wb = load_workbook(BytesIO(build_workbook([r])))
        assert "255" in str(wb["All"].cell(row=2, column=col("Status")).value)

    def test_run_sheet_records_the_config_right_after_all(self) -> None:
        cfg = SweepConfig(
            freq_hz=902_300_000,
            power_values=[1, 2, 3],
            duty_values=[1],
            hp_values=[5],
            settle_ms=450,
            path_loss_db=20.5,
        )
        wb = load_workbook(
            BytesIO(build_workbook([make_row(0, measured=14.0)], cfg, 1_700_000_000.0, None))
        )

        assert wb.sheetnames[:2] == ["All", "Run"], "Run must be findable, not behind the buckets"
        pairs = {r[0].value: r[1].value for r in wb["Run"].iter_rows(min_row=2)}
        assert pairs["Path loss [dB]"] == 20.5
        assert pairs["Settle [ms]"] == 450
        assert pairs["Frequency [MHz]"] == 902.3
        assert pairs["Power Set values"] == "1–3 (3 values)"
        assert pairs["Finished"] == "—", "an unfinished run must not invent an end time"

    def test_run_sheet_is_omitted_when_no_config_is_supplied(self) -> None:
        wb = load_workbook(BytesIO(build_workbook([make_row(0, measured=14.0)])))
        assert "Run" not in wb.sheetnames

    def test_empty_result_set_still_produces_a_valid_workbook(self) -> None:
        wb = load_workbook(BytesIO(build_workbook([])))
        assert wb.sheetnames == ["All"]
        assert [c.value for c in wb["All"][1]] == HEADERS


class TestParseWorkbook:
    """`parse_workbook` is the inverse of `build_workbook`; they share HEADERS,
    so these tests are what stop the two drifting apart."""

    def test_round_trips_every_field_the_workbook_carries(self) -> None:
        cfg = SweepConfig(freq_hz=902_300_000, settle_ms=450, path_loss_db=20.5)
        original = make_row(0, measured=18.89, hp=5, duty=1)
        original.tx_power_dbm_raw = -1.61
        back = parse_workbook(build_workbook([original], cfg))

        assert len(back) == 1
        r = back[0]
        assert r.idx == 0
        assert (r.hp_max, r.pa_duty_cycle) == (5, 1)
        assert r.power_dbm_setting == original.power_dbm_setting
        assert r.tx_power_dbm == pytest.approx(18.89)
        assert r.tx_power_dbm_raw == pytest.approx(-1.61)
        # Written as mA, restored as amps.
        assert r.current_a == pytest.approx(original.current_a, abs=1e-6)
        assert r.voltage_v == pytest.approx(3.6)
        assert r.ok is True

    def test_recovers_the_frequency_from_the_run_sheet(self) -> None:
        cfg = SweepConfig(freq_hz=908_700_000)
        back = parse_workbook(build_workbook([make_row(0, measured=14.0)], cfg))
        assert back[0].freq_hz == 908_700_000

    def test_a_file_without_a_run_sheet_still_imports(self) -> None:
        back = parse_workbook(build_workbook([make_row(0, measured=14.0)]))
        assert len(back) == 1 and back[0].freq_hz == 0

    def test_a_failed_row_comes_back_as_failed(self) -> None:
        r = make_row(0, measured=None)
        r.current_a = None
        r.ok = False
        r.error = "DUT rejected the command (status=255)"
        back = parse_workbook(build_workbook([r]))
        assert back[0].ok is False
        assert back[0].error is not None and "255" in back[0].error

    def test_rejects_a_workbook_that_is_not_ours(self) -> None:
        from openpyxl import Workbook
        wb = Workbook()
        wb.active.title = "Sheet1"
        wb.active.cell(row=1, column=1, value="something else")
        buf = BytesIO()
        wb.save(buf)
        with pytest.raises(ValueError, match="not a sweep workbook"):
            parse_workbook(buf.getvalue())

    def test_rejects_a_workbook_whose_columns_moved(self) -> None:
        from openpyxl import Workbook
        wb = Workbook()
        wb.active.title = "All"
        for c, name in enumerate(["#", "Wrong", "Columns"], start=1):
            wb.active.cell(row=1, column=c, value=name)
        buf = BytesIO()
        wb.save(buf)
        with pytest.raises(ValueError, match="unexpected columns"):
            parse_workbook(buf.getvalue())

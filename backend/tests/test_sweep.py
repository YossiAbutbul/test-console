"""Sweep plan validation and Excel export."""

from __future__ import annotations

from io import BytesIO

import pytest
from openpyxl import load_workbook

from backend.sweep.export import HEADERS, build_workbook
from backend.sweep.models import ResultRow, SweepConfig


def make_row(idx: int, *, measured: float | None, hp: int = 1, duty: int = 1) -> ResultRow:
    return ResultRow(
        idx=idx,
        freq_hz=902_300_000,
        power_dbm_setting=14,
        pa_duty_cycle=duty,
        hp_max=hp,
        tx_power_dbm=measured,
        current_a=0.1234,
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
        # 22 powers x 5 duty cycles x 8 hp values
        assert SweepConfig(freq_hz=902_300_000).total_steps == 22 * 5 * 8

    def test_path_loss_defaults_to_no_correction(self) -> None:
        assert SweepConfig(freq_hz=902_300_000).path_loss_db == 0.0

    @pytest.mark.parametrize(
        ("kwargs", "match"),
        [
            ({"power_values": [0]}, "Power out of range"),
            ({"power_values": [23]}, "Power out of range"),
            ({"duty_values": [5]}, "PaDutyCycle out of range"),
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
            freq_hz=0, power_values=[1, 22], duty_values=[0, 4], hp_values=[0, 7]
        ).validate_ranges()


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
        assert wb["All"].cell(row=2, column=6).value == 123.4

    def test_hp_and_duty_are_exported_as_hex_bytes(self) -> None:
        wb = load_workbook(BytesIO(build_workbook([make_row(0, measured=14.0, hp=7, duty=3)])))
        sheet = wb["All"]
        assert sheet.cell(row=2, column=2).value == "0x07"
        assert sheet.cell(row=2, column=3).value == "0x03"

    def test_empty_result_set_still_produces_a_valid_workbook(self) -> None:
        wb = load_workbook(BytesIO(build_workbook([])))
        assert wb.sheetnames == ["All"]
        assert [c.value for c in wb["All"][1]] == HEADERS

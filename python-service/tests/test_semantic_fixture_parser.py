import unittest
from openpyxl import Workbook

from fastapi.testclient import TestClient

from app.main import app, build_rows, detect_header_hints, find_metadata_row


class SemanticFixtureParserTests(unittest.TestCase):
    def test_build_rows_parses_shifted_semantic_fixture_row(self):
        workbook = Workbook()
        worksheet = workbook.active
        worksheet["A1"] = "WBS-PARC2600M001-Fuel Tank weld Line_CLIENT_ONE"
        worksheet["B3"] = "Part Name"
        worksheet["C3"] = "QTY"
        worksheet["D3"] = "Remark"
        worksheet["E3"] = "Fixture Type"
        worksheet["G3"] = "OP.NO"
        worksheet["H3"] = "Fixture No"
        worksheet["B4"] = "STIFFNER MTG BKT LH/RH SUB ASSLY"
        worksheet["C4"] = 2
        worksheet["D4"] = "PARC scope"
        worksheet["E4"] = "Robotic MIG Welding fixture"
        worksheet["G4"] = "OP 11"
        worksheet["H4"] = "PARC26001001"

        metadata_row, _ = find_metadata_row(worksheet)
        header_hints = detect_header_hints(worksheet, metadata_row)
        rows, errors = build_rows(worksheet, metadata_row, header_hints, {})

        self.assertEqual(errors, [])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["fixture_no"], "PARC26001001")
        self.assertEqual(rows[0]["op_no"], "OP 11")
        self.assertEqual(rows[0]["part_name"], "STIFFNER MTG BKT LH/RH SUB ASSLY")
        self.assertEqual(rows[0]["fixture_type"], "Robotic MIG Welding fixture")
        self.assertEqual(rows[0]["qty"], "2")
        self.assertEqual(rows[0]["remark"], "PARC scope")
        self.assertEqual(rows[0]["parser_confidence"], "HIGH")

    def test_build_rows_skips_title_and_header_rows(self):
        workbook = Workbook()
        worksheet = workbook.active
        worksheet["A1"] = "WBS-PARC2600M001-Fuel Tank weld Line_CLIENT_ONE"
        worksheet["A2"] = "Fuel Tank Weld Line"
        worksheet["A3"] = "FIXTURE NO"
        worksheet["B3"] = "OP.NO"
        worksheet["C3"] = "Part Name"
        worksheet["D3"] = "Fixture Type"
        worksheet["E3"] = "QTY"
        worksheet["A4"] = "PARC26001002"
        worksheet["B4"] = "OP 12"
        worksheet["C4"] = "INNER BRACKET SUB ASSLY"
        worksheet["D4"] = "Checking fixture"
        worksheet["E4"] = 1

        metadata_row, _ = find_metadata_row(worksheet)
        header_hints = detect_header_hints(worksheet, metadata_row)
        rows, errors = build_rows(worksheet, metadata_row, header_hints, {})

        self.assertEqual(errors, [])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["fixture_no"], "PARC26001002")

    def test_build_rows_rejects_low_information_candidate_rows(self):
        workbook = Workbook()
        worksheet = workbook.active
        worksheet["A1"] = "WBS-PARC2600M001-Fuel Tank weld Line_CLIENT_ONE"
        worksheet["A3"] = "PARC26001003"
        worksheet["B3"] = "OP 13"

        metadata_row, _ = find_metadata_row(worksheet)
        header_hints = detect_header_hints(worksheet, metadata_row)
        rows, errors = build_rows(worksheet, metadata_row, header_hints, {})

        self.assertEqual(rows, [])
        self.assertEqual(len(errors), 1)
        self.assertIn("Could not confidently extract required fields", errors[0]["error_message"])

    def test_build_rows_skips_non_fixture_garbage_rows(self):
        workbook = Workbook()
        worksheet = workbook.active
        worksheet["A1"] = "WBS-PARC2600M001-Fuel Tank weld Line_CLIENT_ONE"
        worksheet["A2"] = "Merged title style row"
        worksheet["B3"] = "Another decorative subtitle"

        metadata_row, _ = find_metadata_row(worksheet)
        header_hints = detect_header_hints(worksheet, metadata_row)
        rows, errors = build_rows(worksheet, metadata_row, header_hints, {})

        self.assertEqual(rows, [])
        self.assertEqual(errors, [])

    def test_build_rows_rejects_ambiguous_part_name_without_guessing(self):
        workbook = Workbook()
        worksheet = workbook.active
        worksheet["A1"] = "WBS-PARC2600M001-Fuel Tank weld Line_CLIENT_ONE"
        worksheet["A3"] = "PARC26001004"
        worksheet["B3"] = "OP 14"
        worksheet["C3"] = "LH BRACKET"
        worksheet["D3"] = "RH BRACKET"
        worksheet["E3"] = "Checking fixture"
        worksheet["F3"] = 2

        metadata_row, _ = find_metadata_row(worksheet)
        header_hints = detect_header_hints(worksheet, metadata_row)
        rows, errors = build_rows(worksheet, metadata_row, header_hints, {})

        self.assertEqual(rows, [])
        self.assertEqual(len(errors), 1)
        self.assertIn("Multiple possible values found for Part Name", errors[0]["error_message"])


class ExtractEndpointValidationTests(unittest.TestCase):
    def setUp(self):
        import app.main as main_module

        self.original_token = main_module.SERVICE_TOKEN
        main_module.SERVICE_TOKEN = "test-token"
        self.client = TestClient(app)

    def tearDown(self):
        import app.main as main_module

        main_module.SERVICE_TOKEN = self.original_token

    def test_extract_rejects_wrong_form_field_name_with_422(self):
        response = self.client.post(
            "/extract",
            headers={"x-extraction-token": "test-token"},
            files={
                "excel": (
                    "fixtures.xlsx",
                    b"not-a-real-workbook",
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )

        self.assertEqual(response.status_code, 422)
        self.assertIn("Expected multipart field 'file'", response.json()["errors"][0]["error_message"])


if __name__ == "__main__":
    unittest.main()

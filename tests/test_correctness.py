import unittest
from math import nextafter
from unittest.mock import patch

import pandas as pd
import pm4py

from pm4pyExtension.algo.discovery.efig import get_action_reaction_graph
from pm4pyExtension.algo.normalize import source_normalize_dfg
from pm4pyExtension.algo.reduction import max_path_denoise_dfg, minthreshold_dfg
from pm4pyExtension.preprocessing.Pheonix import preprocess
from pm4pyExtension.tools import make_dfg, make_efig


class PreprocessingTests(unittest.TestCase):
    def setUp(self):
        self.raw = pd.DataFrame({
            "source": ["USA"] * 4,
            "target": ["DEU"] * 4,
            "root_code": [1, 2, 3, 4],
            "story_date": ["2000-01-01 23:59:59", "2000-01-02 00:00:00",
                           "2000-01-02 23:59:59", "2000-01-03 00:00:00"],
        })

    def test_date_bounds(self):
        original = self.raw.copy()
        for start, end, expected in [
            (None, None, [1, 2, 3, 4]),
            ("2000-01-02", "2000-01-02", [2, 3]),
            ("2000-01-01", "2000-01-02", [1, 2, 3]),
            ("2000-01-02", None, [2, 3, 4]),
            (None, "2000-01-02", [1, 2, 3]),
        ]:
            with self.subTest(start=start, end=end):
                result = preprocess(self.raw, start_date=start, end_date=end)
                self.assertEqual(result.root_code.tolist(), expected)
        pd.testing.assert_frame_equal(self.raw, original)

    def test_empty_filtered_graph(self):
        log = preprocess(self.raw, key="DEUUSA")
        self.assertEqual(make_dfg(log, show=False, show_start_end=True), {})

    def test_mixed_dates_and_timezones(self):
        self.raw["story_date"] = ["2000-01-01", "2000-01-02T04:00:00+05:00",
                                  "2000-01-02 12:00", "2000-01-03T00:00:00Z"]
        self.assertEqual(preprocess(self.raw).root_code.tolist(), [1, 2, 3, 4])
        day = preprocess(self.raw, start_date="2000-01-01", end_date="2000-01-01")
        self.assertEqual(day.root_code.tolist(), [1, 2])
        self.assertEqual(day.story_date.iloc[1], pd.Timestamp("2000-01-01T23:00:00Z"))

    def test_empty_graphs_with_display_enabled(self):
        log = preprocess(self.raw)
        empty = pm4py.filter_between(log, "Consult", "Fight")
        with patch.object(pm4py, "view_dfg") as view:
            self.assertEqual(make_dfg(empty, show_start_end=True), {})
            self.assertEqual(make_dfg(log, minThresh=100), {})
            self.assertEqual(make_efig(log, minThresh=100), {})
            view.assert_not_called()

    def test_each_case_gets_endpoint_emphasis(self):
        self.raw.loc[2:, "source"] = "FRA"
        log = preprocess(self.raw)
        result = make_dfg(log, show=False, show_start_end=True, minThresh=2)
        self.assertEqual(result, {
            ("Make Public Statement", "Appeal"): 1,
            ("Express intent to cooperate", "Consult"): 1,
        })

    def test_equal_timestamp_events_keep_input_order(self):
        self.raw["story_date"] = "2000-01-02"
        log = preprocess(self.raw)
        graph = make_efig(log, daysFollow=0, show=False)
        self.assertIn(("Make Public Statement", "Consult"), graph)
        self.assertNotIn(("Consult", "Make Public Statement"), graph)

    def test_denoising_removes_endpoint_self_loops(self):
        self.raw["root_code"] = [1, 1, 2, 2]
        log = preprocess(self.raw)
        options = dict(show=False, show_start_end=True, minThresh=2)
        plain = make_dfg(log, **options)
        self.assertEqual(len(plain), 3)
        self.assertEqual(make_dfg(log, max_path_denoise=True, **options),
                         {("Make Public Statement", "Appeal"): 1})

    def test_decay_uses_elapsed_days_inside_inclusive_window(self):
        self.raw["story_date"] = pd.to_datetime(["2000-01-01", "2000-01-04 12:00",
                                                 "2000-01-08", "2000-03-01"], format="mixed")
        log = preprocess(self.raw)
        graph = make_efig(log, daysFollow=7, show=False, time_decay=True)
        self.assertAlmostEqual(graph["Make Public Statement", "Appeal"], 2 ** -0.5)
        self.assertEqual(graph["Make Public Statement", "Express intent to cooperate"], 0.5)
        self.assertNotIn(("Make Public Statement", "Consult"), graph)
        self.assertEqual(get_action_reaction_graph(log, log, 7, time_decay=True), graph)

    def test_custom_half_life(self):
        self.raw["story_date"] = ["2000-01-01", "2000-01-02", "2000-01-04", "2000-01-05"]
        log = preprocess(self.raw)
        graph = make_efig(log, daysFollow=1, time_decay=True, half_life_days=0.5, show=False)
        self.assertEqual(graph["Make Public Statement", "Appeal"], 0.25)
        self.assertEqual(get_action_reaction_graph(log, log, 1, time_decay=True, half_life_days=0.5), graph)
        for invalid in [0, -1, float("nan"), float("inf")]:
            with self.assertRaisesRegex(ValueError, "half_life_days"):
                make_efig(log, time_decay=True, half_life_days=invalid, show=False)

    def test_normalization_preserves_relative_weights_below_float_range(self):
        self.raw["story_date"] = [pd.Timestamp("2000-01-01") + pd.Timedelta(days=n)
                                  for n in [0, 1286, 1287, 1287]]
        log = preprocess(self.raw)
        first = "Make Public Statement"
        kwargs = dict(time_decay=True, half_life_days=1, normalize_to="source")
        graph = make_efig(log, daysFollow=1300, normalize=True, show=False, **kwargs)
        self.assertEqual(graph[first, "Appeal"], 0.5)
        self.assertEqual(graph[first, "Consult"], 0.25)
        actions = preprocess(self.raw.iloc[:1])
        responses = preprocess(self.raw.iloc[1:])
        graph = get_action_reaction_graph(actions, responses, 1300, **kwargs)
        self.assertEqual(graph[first, "Appeal"], 0.5)
        self.assertEqual(graph[first, "Consult"], 0.25)
        sole = make_efig(preprocess(self.raw.iloc[:2]), daysFollow=1300, time_decay=True,
                        half_life_days=1, normalize=True, normalize_to="target", show=False)
        self.assertEqual(sole, {(first, "Appeal"): 1})


class ReductionTests(unittest.TestCase):
    def test_inclusive_thresholds_and_ties_tolerate_float_roundoff(self):
        almost_half = nextafter(0.5, 0)
        graph = {("A", "B"): almost_half, ("A", "C"): 0.5, ("C", "B"): 0.5}
        self.assertEqual(max_path_denoise_dfg(graph), graph)
        self.assertEqual(minthreshold_dfg(graph, 0.5), graph)
        self.assertEqual(minthreshold_dfg(graph, 0.50001), {})

    def test_zero_total_does_not_partially_normalize_graph(self):
        graph = {("A", "B"): 2, ("C", "D"): 0}
        with self.assertRaisesRegex(ValueError, "zero-total"):
            source_normalize_dfg(graph)
        self.assertEqual(graph, {("A", "B"): 2, ("C", "D"): 0})

    def test_only_eligible_edges_compete_and_ties_survive(self):
        graph = {("A", "A"): 10, ("B", "B"): 9, ("C", "C"): 8,
                 ("A", "B"): 4, ("A", "C"): 4, ("B", "C"): 3, ("B", "A"): 5}
        self.assertEqual(max_path_denoise_dfg(graph),
                         {("A", "B"): 4, ("A", "C"): 4, ("B", "A"): 5})

from enum import Enum
from math import isfinite, log2
from numbers import Real
import pandas
from pm4py.util import xes_constants, constants
from pm4py.objects.conversion.log import converter
from pm4pyExtension.algo.normalize import source_normalize_dfg, target_normalize_dfg


class Parameters(Enum):
    ACTIVITY_KEY = constants.PARAMETER_CONSTANT_ACTIVITY_KEY
    TIMESTAMP_KEY = constants.PARAMETER_CONSTANT_TIMESTAMP_KEY
    START_TIMESTAMP_KEY = constants.PARAMETER_CONSTANT_START_TIMESTAMP_KEY
    KEEP_FIRST_FOLLOWING = "keep_first_following"


_DAY = pandas.Timedelta(days=1)
DEFAULT_HALF_LIFE_DAYS = 7


def _validate_half_life(days):
    if isinstance(days, bool) or not isinstance(days, Real) or not isfinite(days) or days <= 0:
        raise ValueError("half_life_days must be a positive finite number")


def _sorted_traces(log):
    traces = converter.apply(log, variant=converter.Variants.TO_EVENT_LOG)
    for trace in traces:
        events = [(event[xes_constants.DEFAULT_TIMESTAMP_KEY], event[xes_constants.DEFAULT_NAME_KEY])
                  for event in trace]
        yield sorted(events, key=lambda event: event[0])


def _pairs(actions, following, window, same_trace):
    first = 0
    for i, (time, action) in enumerate(actions):
        if same_trace:
            first = i + 1
        else:
            while first < len(following) and following[first][0] <= time:
                first += 1
        for j in range(first, len(following)):
            timestamp, reaction = following[j]
            lag = timestamp - time
            if lag > window:
                break
            yield (action, reaction), lag


def _shift_weight(value, days, half_life):
    exponent = -days / half_life
    return 2 ** (log2(value) + exponent) if exponent < -1022 else value * 2 ** exponent


def _aggregate(pairs, time_decay, half_life, normalize_to):
    if normalize_to not in (None, "source", "target"):
        raise ValueError("normalize_to must be 'source' or 'target'")
    graph = {}
    if time_decay:
        _validate_half_life(half_life)
        # Keep each sum relative to its shortest lag until the normalization group is known.
        scores = {}
        for edge, elapsed in pairs:
            lag = elapsed / _DAY
            if edge in scores:
                previous, total = scores[edge]
                anchor = min(previous, lag)
                total = _shift_weight(total, previous - anchor, half_life) + _shift_weight(1, lag - anchor, half_life)
                scores[edge] = (anchor, total)
            else:
                scores[edge] = (lag, 1)
        anchors = {}
        side = 0 if normalize_to == "source" else 1
        if normalize_to:
            for edge, (lag, _) in scores.items():
                group = edge[side]
                anchors[group] = min(anchors.get(group, lag), lag)
        for edge, (lag, total) in scores.items():
            graph[edge] = _shift_weight(total, lag - anchors.get(edge[side], 0), half_life)
    else:
        for edge, _ in pairs:
            graph[edge] = graph.get(edge, 0) + 1
    if normalize_to == "source":
        return source_normalize_dfg(graph)
    if normalize_to == "target":
        return target_normalize_dfg(graph)
    return graph


def get_action_reaction_graph(action_event_log, reaction_event_log, daysFollow, *, time_decay=False,
                              half_life_days=DEFAULT_HALF_LIFE_DAYS, normalize_to=None):
    """Connect actions to strictly later reactions within the inclusive elapsed-time window."""
    window = pandas.Timedelta(days=daysFollow)
    reactions = list(_sorted_traces(reaction_event_log))
    pairs = (pair for actions in _sorted_traces(action_event_log) for following in reactions
             for pair in _pairs(actions, following, window, same_trace=False))
    return _aggregate(pairs, time_decay, half_life_days, normalize_to)


def get_eventually_follows_in_days_graph(event_log, daysFollow, *, time_decay=False,
                                         half_life_days=DEFAULT_HALF_LIFE_DAYS, normalize_to=None):
    """Connect each event to later entries in its trace, preserving input order for equal times."""
    window = pandas.Timedelta(days=daysFollow)
    pairs = (pair for trace in _sorted_traces(event_log)
             for pair in _pairs(trace, trace, window, same_trace=True))
    return _aggregate(pairs, time_decay, half_life_days, normalize_to)

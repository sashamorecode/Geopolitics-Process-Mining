from math import isclose
from sys import float_info


def _at_least(weight, threshold):
    return weight >= threshold or isclose(weight, threshold, rel_tol=16 * float_info.epsilon)


def minthreshold_dfg(dfg, threshold):
    return {edge: value for edge, value in dfg.items() if _at_least(value, threshold)}

def max_path_denoise_dfg(dfg):
    edges = {edge: weight for edge, weight in dfg.items() if edge[0] != edge[1]}
    max_out = {}
    max_in = {}
    for (source, target), weight in edges.items():
        max_out[source] = max(max_out.get(source, weight), weight)
        max_in[target] = max(max_in.get(target, weight), weight)

    return {
        (source, target): weight
        for (source, target), weight in edges.items()
        if _at_least(weight, max_out[source]) or _at_least(weight, max_in[target])
    }

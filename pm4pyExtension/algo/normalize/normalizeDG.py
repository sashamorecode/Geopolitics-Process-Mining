def _normalize(dfg, side):
    totals = {}
    for edge, weight in dfg.items():
        group = edge[side]
        totals[group] = totals.get(group, 0) + weight
    if any(total == 0 for total in totals.values()):
        raise ValueError("Cannot normalize a zero-total group. For time decay, pass normalize_to at discovery.")
    for edge in dfg:
        dfg[edge] /= totals[edge[side]]
    return dfg


def target_normalize_dfg(dfg):
    """Normalize each target's incoming weights in place."""
    return _normalize(dfg, 1)


def source_normalize_dfg(dfg):
    """Normalize each source's outgoing weights in place."""
    return _normalize(dfg, 0)

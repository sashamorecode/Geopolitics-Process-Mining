
def merge_action_reaction_graphs(act_rect_graphs, countryNames):
    assert(len(act_rect_graphs) == len(countryNames) or len(act_rect_graphs) == len(countryNames) - 1)
    act_rect_graphs_renamed = {}
    for i, act_rect_graph in enumerate(act_rect_graphs):
        for (action, reaction), val in act_rect_graph.items():
            if (countryNames[i] + " " + action, countryNames[(i+1) % len(countryNames)] + " " + reaction) not in act_rect_graphs_renamed:
                act_rect_graphs_renamed[(countryNames[i] + " " + action, countryNames[(i+1) % len(countryNames)] + " " + reaction)] = 0
            act_rect_graphs_renamed[(countryNames[i] + " " + action, countryNames[(i+1) % len(countryNames)] + " " + reaction)] += val
    merged_act_rect_graph = {}
    for k, v in act_rect_graphs_renamed.items():
        if k in merged_act_rect_graph:
            merged_act_rect_graph[k] += v
        else:
            merged_act_rect_graph[k] = v
    return merged_act_rect_graph
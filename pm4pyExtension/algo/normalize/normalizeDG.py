def target_normalize_dfg(dfg):
    #normalize the edges to each target node to sum to 1
    #note im using the origional dfg here so when we max_path_denoise
    #so we can see how much percent of the incoming transitions each transition represents

    # create a dictionary to store the total weight of transitions into each target node
    total_weight = {}
    for (source, target), weight in dfg.items():
        if target in total_weight:
            total_weight[target] += weight
        else:
            total_weight[target] = weight

    # normalize the weight of transitions into each target node
    for (source, target), weight in dfg.items():
        dfg[(source, target)] = (weight / total_weight[target]) 

    return dfg 

def source_normalize_dfg(dfg):
    #normalize the edges to each source node to sum to 1
    #note im using the origional dfg here so when we max_path_denoise
    #so we can see how much percent of the incoming transitions each transition represents

    # create a dictionary to store the total weight of transitions into each source node
    total_weight = {}
    absolut_weight = 0
    for (source, target), weight in dfg.items():
        absolut_weight += weight
        if source in total_weight:
            total_weight[source] += weight
        else:
            total_weight[source] = weight

    # normalize the weight of transitions into each source node
    for (source, target), weight in dfg.items():
        dfg[(source, target)] = (weight / total_weight[source])

    return dfg
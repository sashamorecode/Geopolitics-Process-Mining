


def minthreshold_dfg(dfg, threshold):
    return {activities: value for activities, value in dfg.items() if value >= threshold}

def max_path_denoise_dfg(dfg):
    #a bit hacky TODO: clean it up
    return {activities: value for activities, value in dfg.items() 
               if activities[0] != activities[1] and 
               (value >= max([x for k,x in dfg.items() if k[0] == activities[0]])
                or value >= max([x for k,x in dfg.items() if k[1] == activities[1]]))}

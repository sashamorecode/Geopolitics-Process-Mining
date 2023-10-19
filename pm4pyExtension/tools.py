import pm4py
from pm4pyExtension.algo.discovery.efig import get_eventually_follows_in_days_graph
from pm4pyExtension.algo.normalize.normalizeDG import source_normalize_dfg, target_normalize_dfg
from pm4pyExtension.algo.reduction.reduceDG import max_path_denoise_dfg, minthreshold_dfg



def normalize_dfg_to(dfg, normalize_to = "source"):
    if normalize_to == "source":
        return source_normalize_dfg(dfg)
    elif normalize_to == "target":
        return target_normalize_dfg(dfg)
    else:
        raise ValueError("normalize_to must be 'source' or 'target'")

def make_efig(event_log, show=True, daysFollow=3, normalize = False, normalize_to = "target", minThresh = 0., max_path_denoise=False):
    efg = get_eventually_follows_in_days_graph(event_log, daysFollow)
    
    if normalize:
        efg = normalize_dfg_to(efg, normalize_to)

    if max_path_denoise:
        efg = max_path_denoise_dfg(efg)      

    if minThresh > 0.:
        efg = minthreshold_dfg(efg, minThresh)

    if show:
        pm4py.view_dfg(efg, start_activities=None, end_activities=None, format='png')
    return efg    

def make_dfg(event_log, minThresh = 1,
            max_path_denoise=False,
            show=True, show_start_end=False,
            normalize = False, normalize_to = "target",
            start_end_emphasis=2):
    
    dfg, start_activities, end_activities = pm4py.discover_dfg(event_log)
    
    if normalize:
        dfg = normalize_dfg_to(dfg, normalize_to)

    print(start_activities.keys())

    if show_start_end:
        start_activity = next(iter(start_activities))
        end_activitity = next(iter(end_activities))
        save_start_end = {}
        for (act1,act2), val in dfg.items():
            if act1 == start_activity:
                save_start_end[(act1,act2)] = val
            elif act2 == end_activitity:
                save_start_end[(act1,act2)] = val
    
    if max_path_denoise:
        dfg = max_path_denoise_dfg(dfg)      


    dfg = minthreshold_dfg(dfg, minThresh)



    if show_start_end:
        for (act1,act2), val in save_start_end.items():
            if val >= minThresh/start_end_emphasis:
                dfg[(act1,act2)] = val
    if show:
        if show_start_end:
            pm4py.view_dfg(dfg, start_activities=start_activities, end_activities=end_activities, format='png')
        else:
            pm4py.view_dfg(dfg, start_activities=None, end_activities=None, format='png')
    return dfg

def make_petrinet(event_log, show=True):
    #no clue what markings are but this should get us a petrinet
    #network, iMarking, fMarking = pm4py.discovery.discover_petri_net_alpha(event_log)
    #network, iMarking, fMarking = pm4py.discover_petri_net_inductive(event_log,noise_threshold = 0.7)
    network, iMarking, fMarking = pm4py.discover_petri_net_heuristics(event_log)
    if show:
        pm4py.view_petri_net(network, iMarking, fMarking)
    return network, iMarking, fMarking
    
def make_bpmn(event_log, show=True):
    efg = pm4py.discover_bpmn_inductive(event_log, noise_threshold = 0.7, multi_processing=True)
    if show:
        pm4py.view_bpmn(efg)
    return efg

def make_process_tree(event_log, show=True):
    process_tree = pm4py.discover_process_tree_inductive(event_log)
    bpmn_model = pm4py.convert_to_bpmn(process_tree)
    if(show):
        pm4py.view_bpmn(bpmn_model)
    return process_tree



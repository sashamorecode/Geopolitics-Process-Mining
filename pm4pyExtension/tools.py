from pandas import DataFrame
import pm4py
from pm4pyExtension.algo.discovery.efig import DEFAULT_HALF_LIFE_DAYS, get_eventually_follows_in_days_graph
from pm4pyExtension.algo.normalize.normalizeDG import source_normalize_dfg, target_normalize_dfg
from pm4pyExtension.algo.reduction.reduceDG import max_path_denoise_dfg, minthreshold_dfg



def normalize_dfg_to(dfg, normalize_to = "source"):
    if normalize_to == "source":
        return source_normalize_dfg(dfg)
    elif normalize_to == "target":
        return target_normalize_dfg(dfg)
    else:
        raise ValueError("normalize_to must be 'source' or 'target'")

def make_efig(event_log, show=True, daysFollow=3, normalize = False, normalize_to = "target", minThresh = 0., max_path_denoise=False, *,
              time_decay=False, half_life_days=DEFAULT_HALF_LIFE_DAYS):
    efg = get_eventually_follows_in_days_graph(event_log, daysFollow, time_decay=time_decay,
                                              half_life_days=half_life_days,
                                              normalize_to=normalize_to if normalize else None)

    if max_path_denoise:
        efg = max_path_denoise_dfg(efg)      

    if minThresh > 0.:
        efg = minthreshold_dfg(efg, minThresh)

    if show and efg:
        pm4py.view_dfg(efg, start_activities=None, end_activities=None, format='png')
    return efg    

def make_dfg(event_log, minThresh = 1,
            max_path_denoise=False,
            show=True, show_start_end=False,
            normalize = False, normalize_to = "target",
            start_end_emphasis=2):
    
    if isinstance(event_log, DataFrame) and len(event_log) == 0:
        return {}
    dfg, start_activities, end_activities = pm4py.discover_dfg(event_log)
    
    if normalize:
        dfg = normalize_dfg_to(dfg, normalize_to)

    if show_start_end:
        if start_end_emphasis <= 0:
            raise ValueError("start_end_emphasis must be positive")
        endpoint_threshold = minThresh / start_end_emphasis
        endpoint_edges = {
            (source, target): weight
            for (source, target), weight in dfg.items()
            if (source in start_activities or target in end_activities)
            and (not max_path_denoise or source != target)
            and weight >= endpoint_threshold
        }

    if max_path_denoise:
        dfg = max_path_denoise_dfg(dfg)

    dfg = minthreshold_dfg(dfg, minThresh)
    if show_start_end:
        dfg.update(endpoint_edges)
    if show and dfg:
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



import pandas
import pm4py


def code2text_Pheonix(event_log):
    #translatets root_codes for pheonix data
    translationMap = {"1":"Make Public Statement", "2":"Appeal", "3":"Express intent to cooperate",
                    "4":"Consult", "5":"Engage in diplomatic cooperation","6":"Engage in material cooperation",
                    "7":"Provide aid", "8":"Yield", "9":"Investigate", 
                    "10":"Demand", "11":"Disapprove", "12":"Reject", 
                    "13":"Threaten", "14":"Protest", "15":"Exhibit force posture", 
                    "16":"Reduce relations", "17":"Coerce", "18":"Assault",
                    "19":"Fight","20":"Use unconventional mass violence"}
    def translate(x):
        return translationMap[str(x)]
    event_log['root_code_text'] = event_log['root_code'].apply(translate)    
    return event_log

def preprocess(event_log, key="empty", remove_activity_keys=[], start_date="1780-01-01", end_date="1780-01-01"):
    #end_date = pandas.to_datetime(end_date, utc=True)

    #remove activities
    if len(remove_activity_keys) > 0:
        for code_key in remove_activity_keys:
            event_log = event_log[event_log.root_code != code_key]
            print(event_log["root_code"])
            
    #extract root country
    event_log["source_root"] = event_log["source"].apply(lambda x : x[0:3])
    event_log["target_root"] = event_log["target"].apply(lambda x : x[0:3])
    #create conflict_id
    event_log["conflict_id"] = event_log["source_root"] + event_log["target_root"]
    #select conflict
    if key != "empty":
        event_log = event_log[event_log.conflict_id == key]
    

    #event_log = event_log[event_log.source == "DDR"]
    #order by date
    event_log = event_log.sort_values(by=['story_date'])
    #decode codes
    
    event_log = code2text_Pheonix(event_log)
    if start_date != end_date:
        event_log = extract_time_range(event_log, start_date, end_date)
    #format to pm4py
    
    event_log = pm4py.format_dataframe(event_log, case_id='conflict_id', activity_key='root_code_text', timestamp_key='story_date')


    return event_log

def import_csv(file_path):
    event_log = pandas.read_csv(file_path, sep=',')
    return event_log 

def extract_time_range(event_log, start_date, end_date):
    start_date += " 00:00:00"
    end_date += " 00:00:00"
    start_date = pandas.to_datetime(start_date, utc=True)
    end_date = pandas.to_datetime(end_date, utc=True)
    event_log["story_date"] = pandas.to_datetime(event_log["story_date"] , utc=True)
    event_log = event_log[(event_log.story_date >= start_date) & (event_log.story_date <= end_date)]
    return event_log

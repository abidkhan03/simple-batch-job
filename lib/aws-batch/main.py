import pandas as pd

data = [['Cristiano Ronaldo', 7], ['Mpabbe', 10], ['Juan Mata', 8], ['Bruno Fernandez', 19], ['Neymar', 1]]

df = pd.DataFrame(data, columns = ['Name', 'Jersey Number'])

print('Author -> Abid Khan')
print("-"*50)
print("Hello Everyone welcome to AWS BATCH")
print("-"*50)
print(df)
print("-"*50)


# import json
# import os
# from typing import List, Any
# from datetime import datetime, timedelta
# import pytz
# import requests


# time_zone = pytz.timezone('Asia/Kolkata')
# date_time_obje = datetime.now(time_zone)
# DATE = (date_time_obje.today() + timedelta(days=-1)).date()
# API_KEY = os.environ.get('API_KEY', 'i3m50gE5BpNWXnACeOX6XEnea1t4i4ig')
# print(os.getcwd())

# def get_tickers() -> List:
#     file_path = os.path.join(os.path.dirname(__file__), 'tickers.txt')
#     with open(file_path) as f:
#         data = f.readlines()
#         return data
    
# def process_tickers() -> Any:
#     tickers_list = get_tickers()
#     for ticker in tickers_list:
#         ticker = ticker.replace('\n', '')
#         file_name = f"{str(ticker).lower()}.json"
#         file_path = os.path.abspath(file_name)
#         file_exists = os.path.exists(file_path)
#         if file_exists is False:
#             base_url = 'https://api.polygon.io/v1/open-close/{ticker}/{DATE}?adjusted=true&apiKey={API_KEY}'
#             data = requests.get(base_url)
#             print(f'TICKER -> {ticker} | STATUS -> {data.status_code}')
#             if data.status_code == 429:
#                 return data
#             else:
#                 with open(file_name, 'w') as file_obj:
#                     file_obj.write(json.dumps(data.json()))
#                     file_obj.close()
#                     # Upload file to S3


# if __name__ == '__main__':
#     process_tickers()
    



# try:
#     import sys
#     import json
#     import datetime

#     print("All imports ok ...")

# except Exception as e:
#     print(f'Error imports : {e}')


# def lambda_handler(event={}):
#     print(f'event {event}')
#     print(sys.argv, 'sys.argv')

#     event['message'] = "I am batch function fired."
#     event['datetime'] = datetime.datetime.now().__str__()

#     print(event)
#     return event

# lambda_handler()
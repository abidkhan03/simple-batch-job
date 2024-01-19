import os
import json
import pandas as pd
from datetime import datetime
from alpaca.trading.client import TradingClient
from alpaca.trading.requests import GetAssetsRequest
from alpaca.data.requests import StockBarsRequest
from alpaca.data.historical import StockHistoricalDataClient
from alpaca.data.timeframe import TimeFrame, TimeFrameUnit
import logging
from autots import AutoTS
import argparse


logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize clients with environment variables
api_key = os.environ['ALPACA_API_KEY']
secret_key = os.environ['ALPACA_API_SECRET']
# api_key = 'PKKBATPEGK51Y0FUV170'
# secret_key = 'soZvm833djbWDPzaCdOxhk35TvWHRiYP2NPiXM6t'
# bucket_name = os.environ['BUCKET_NAME']
client = TradingClient(api_key, secret_key)
data_client = StockHistoricalDataClient(api_key, secret_key)


def convert_to_timeframe(tf):
    if tf.lower() == 'minute':
        return TimeFrame.Minute
    elif tf.lower() == 'hour':
        return TimeFrame.Hour
    elif tf.lower() == 'day':
        return TimeFrame.Day
    elif tf.lower() == 'week':
        return TimeFrame.Week
    elif tf.lower() == 'month':
        return TimeFrame.Month
    else:
        raise ValueError(
            f'''Invalid timeframe: {tf}. 
            Please provide a timeframe one of the following: Minute, Hour, Day, Week, Month'''
        )


def get_stock_data(start_date, end_date, timeframe):
    # Fetch stock bars data based on the parameters
    data_df = data_client.get_stock_bars(
        StockBarsRequest(
            symbol_or_symbols=[
                'AAPL', 'IEX', 'TSLA', 'MSFT', 'FB',
                'GOOGL', 'AMZN', 'NFLX', 'AMD', 'NVDA',
                'CSCO', 'TMDX', 'FATH', 'ONHO', 'DDOG'
            ],
            start=start_date,
            end=end_date,
            timeframe=timeframe,
        )
    ).df.tz_convert('America/New_York', level='timestamp')
    return data_df


def lambda_handler(event, context):
    # Extract parameters from the event
    symbol = event.get('symbol', 'AAPL')
    logger.info(f'symbol: {symbol}')
    start = pd.to_datetime(event.get('start', '2022-12-02')
                           ).tz_localize('America/New_York')
    end = pd.to_datetime(event.get('end', '2023-12-07')
                         ).tz_localize('America/New_York')
    timeframe = event.get('timeframe', "Hour")
    timeframe = convert_to_timeframe(timeframe)
    logger.info(f'start: {start}, end: {end}, timeframe: {timeframe}')

    # Fetch bars for the previous five years
    try:
        bars = get_stock_data(start, end, timeframe)

        bars.reset_index(inplace=True)
        bars['timestamp'] = pd.to_datetime(
            bars['timestamp']).dt.tz_localize(None)
        symbol_bars = bars[bars['symbol'] == symbol]

        model_list = [
            'LastValueNaive',
            'GLS',
            'ETS',
            'AverageValueNaive',
        ]

        model = AutoTS(
            forecast_length=30,
            frequency='H',
            ensemble='all',
            model_list=model_list,
            max_generations=15,
            # validation_method='backwards',
            # n_jobs=1,
            num_validations=2,
            transformer_list='all',
            # drop_most_recent=1,
            prediction_interval=0.95,
            subset=100,
            remove_leading_zeroes=True,
        )

        # Fit the model
        model = model.fit(symbol_bars, date_col='timestamp',
                          value_col='close', id_col=None)

        # Predict the next one month of hourly stock prices
        prediction = model.predict(forecast_length=720)

        # model_results = model.results()
        # logger.info(f'model results: {model_results}')

        # Convert the prediction to a DataFrame for easier handling
        forecast = prediction.forecast
        # these three lines are important to reset index and named the columns and format the timestamp for json conversion,
        # But for plotting, it's not necessary and can be commented out
        forecast.reset_index(inplace=True)
        forecast.columns = ['timestamp', 'close price']
        forecast['timestamp'] = forecast['timestamp'].dt.strftime(
            '%Y-%m-%d %H:%M:%S%z')

        # convert dataframe into json
        forecast_data = forecast.to_dict(orient='records')
        # print(forecast_data)
        print('symbol: ', symbol)
        print(forecast_data)

        return {
            'statusCode': 200,
            'body': {
                'symbol': symbol,
                'data': forecast_data
            }
        }

    except Exception as e:
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--symbol', type=str, default='AAPL')
    parser.add_argument('--start', type=str, default='2022-12-02')
    parser.add_argument('--end', type=str, default='2023-12-07')
    parser.add_argument('--timeframe', type=str, default='Hour')
    args = parser.parse_args()

    event = {
        'symbol': args.symbol,
        'start': args.start,
        'end': args.end,
        'timeframe': args.timeframe
    }
    response = lambda_handler(event, None)
    print(response)


# import os
# import json
# from datetime import datetime
# from alpaca.trading.enums import AssetClass
# from alpaca.data.timeframe import TimeFrame
# from alpaca.trading.client import TradingClient
# from alpaca.trading.requests import GetAssetsRequest
# from alpaca.data.requests import StockBarsRequest
# from alpaca.data.historical import StockHistoricalDataClient
# import pandas as pd
# from autots import AutoTS


# # API_KEY = 'PKKBATPEGK51Y0FUV170'
# # SECRET_KEY = 'soZvm833djbWDPzaCdOxhk35TvWHRiYP2NPiXM6t'
# API_KEY = os.environ['ALPACA_API_KEY']
# SECRET_KEY = os.environ['ALPACA_API_SECRET']

# # get all assets and store the symbols into a list
# client = TradingClient(API_KEY, SECRET_KEY)
# request_params = GetAssetsRequest(status='active')
# assets = client.get_all_assets(request_params)
# symbols = [asset.symbol for asset in assets]
# print(len(symbols))
# # print only if IEX in symbol
# symbol = [symbol for symbol in symbols if 'IEX' in symbol]
# print(symbol)

# data_client = StockHistoricalDataClient(API_KEY, SECRET_KEY)

# today = pd.to_datetime('2023-12-06 12:30').tz_localize('America/New_York')
# last_five_years = today - pd.Timedelta(days=3*365)
# # Fetch today and yesterday's data and convert to dataframe
# bars = data_client.get_stock_bars(StockBarsRequest(
#                                   symbol_or_symbols=[
#                                       'AAPL', 'IEX', 'TSLA', 'MSFT', 'FB',
#                                       'GOOGL', 'AMZN', 'NFLX', 'AMD', 'NVDA',
#                                       'CSCO', 'TMDX', 'FATH', 'ONHO', 'DDOG'
#                                   ],
#                                   start=last_five_years,
#                                   end=today,
#                                   timeframe=TimeFrame.Hour,
#                                   )).df.tz_convert('America/New_York', level='timestamp')

# bars.reset_index(inplace=True)
# bars['timestamp'] = pd.to_datetime(bars['timestamp']).dt.tz_localize(None)
# # bars.to_csv('bars.csv', index=False)

# apple_bars = bars[bars['symbol'] == 'AAPL']

# model = AutoTS(
#     forecast_length=30,
#     frequency='H',
#     ensemble='all',
#     model_list="superfast",
#     transformer_list='superfast',
#     max_generations=10,
#     validation_method='backwards',
#     # n_jobs=1,
#     num_validations=2,
#     # drop_most_recent=1,
#     prediction_interval=0.9,
# )

# # Fit the model
# model = model.fit(apple_bars, date_col='timestamp',
#                   value_col='close', id_col=None)

# # Predict the next one month of hourly stock prices
# prediction = model.predict(forecast_length=720)

# model_results = model.results()

# # Convert the prediction to a DataFrame for easier handling
# forecast = prediction.forecast

# forecast.reset_index(inplace=True)
# forecast.columns = ['timestamp', 'close price']
# forecast['timestamp'] = forecast['timestamp'].dt.strftime(
#     '%Y-%m-%d %H:%M:%S%z')

# # convert dataframe into json
# forecast_data = forecast.to_dict(orient='records')
# print(forecast_data)


# import pandas as pd

# def lambda_handler():
#     data = [['Cristiano Ronlado', 7], ['Juan Mata', 8], ['Bruno Fernandez', 18], ['Kohli', 10], ['Salah', 11], ['Messi', 10]]
#     print('data; ',data)
#     df = pd.DataFrame(data, columns=['Name', 'Jersey Number'])
#     return {
#         'statusCode': 200,
#         'body': df.to_dict(orient='records')
#     }

# if __name__ == "__main__":
#     lambda_handler()
#     print("Batch job completed...")

FROM python:3.11

COPY requirements.txt .
# RUN pip install --no-cache-dir -r requirements.txt
RUN pip install -r requirements.txt

# ADD requirements.txt .
COPY stock_data.py .

# RUN pip install boto3
# RUN pip install pandas
# RUN pip install alpaca-py
# RUN pip install autots

CMD [ "python","./stock_data.py"]
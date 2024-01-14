FROM python:3.11

# ADD requirements.txt .
# RUN pip install --no-cache-dir -r requirements.txt
# RUN pip install -r requirements.txt

# ADD requirements.txt .
ADD stock_data.py .

RUN pip install pandas

CMD [ "python","./stock_data.py"]
import asyncio
import websockets
import json

async def test_streamlit():
    uri = "ws://localhost:8501/_stcore/stream"
    try:
        async with websockets.connect(uri) as websocket:
            print("Connected to Streamlit WebSocket.")
            # Streamlit doesn't require a message to start, it sends messages on connect
            while True:
                try:
                    message = await asyncio.wait_for(websocket.recv(), timeout=5.0)
                    if isinstance(message, bytes):
                        print(f"Received bytes of length {len(message)}")
                        # In Streamlit, binary messages are usually ForwardMsg protobufs
                    else:
                        print(f"Received text: {message}")
                except asyncio.TimeoutError:
                    print("Timeout waiting for message. Closing.")
                    break
    except Exception as e:
        print(f"Connection failed: {e}")

if __name__ == "__main__":
    asyncio.run(test_streamlit())

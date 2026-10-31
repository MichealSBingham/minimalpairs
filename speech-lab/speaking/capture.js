class WordCapture extends AudioWorkletProcessor {
  constructor(){super();this.buffer=new Float32Array(1024);this.offset=0;this.finished=false;
    this.port.onmessage=e=>{if(e.data==='finish'){this.finished=true;
      if(this.offset)this.port.postMessage({samples:this.buffer.slice(0,this.offset)});
      this.port.postMessage({finished:true});}};}
  process(inputs){if(this.finished)return false;const input=inputs[0]?.[0];
    if(input)for(const sample of input){this.buffer[this.offset++]=sample;
      if(this.offset===this.buffer.length){this.port.postMessage({samples:this.buffer});this.buffer=new Float32Array(1024);this.offset=0;}}
    return true;}
}
registerProcessor('word-capture',WordCapture);

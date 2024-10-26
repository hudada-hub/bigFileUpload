


const SIZE=10*1024*1024;//切片大小
const CONCURRENCY_LIMIT=4;//并发数量控制
const baseUrl="http://localhost:3000"
const UPLOAD_STATUS={
    calculatingHash:"calculatingHash",//正在计算hash
    waiting:"waiting",//等待用户开始上传
    uploading:"uploading",//正在上传
    abort:"abort",//暂停上传
    success:"success",//后端文件合并完毕，文件秒传也应该是这个状态
    fail:"上传失败",//上传失败
}

let fileInfo={
    filename:"",//文件名
    fileSize:0,
    data:[],
    hashPercentage:0,
    container:{
        worker:null,
        hash:null
    },//容器信息
    requestList:[],
    Scheduler:null,//并发任务调度器，所有请求会通过该调度器来完成，并且实现了错误重试功能
    uploadStatus:UPLOAD_STATUS,
    curStatus:UPLOAD_STATUS.waiting
}

function handleUplad(){
    document.getElementById("fileInput").click();
}
//暂停上传
function handlePause(){
    fileInfo.requestList.forEach(xhr=>xhr?.abort())
    fileInfo.requestList=[];
}
//继续上传
async function handleResume(){
    const {uploadedList}=await verifyUpload(fileInfo.filename,fileInfo.container.hash)
    await uploadChunks(uploadedList)
}
document.getElementById("fileInput").addEventListener("change",async function(event){
    const files=event.target.files;
    if(files.length>0){
        const file=files[0];
        console.log(file);
        
        // console.log("选择的文件", file.name)

        fileInfo.filename=file.name;
        fileInfo.fileSize=file.size;
        //创建文件切片
        const fileChunkList=createFileChunk(file)
        //得到大文件hash
        fileInfo.container.hash=await calculateHash(fileChunkList);


        //验证是否应该继续上传
        const {shouldUpload,uploadedList} = await verifyUpload(fileInfo.filename,fileInfo.container.hash)
        if(!shouldUpload){
            console.log("文件上传成功")
            return;
        }
        // console.log(uploadedList,"uploadedList")
        fileInfo.data=fileChunkList.map(({file},index)=>({
            chunk:file,
            index,
            percentage:uploadedList?.includes(index)?100:0,
            //文件名+数组下标
            hash:fileInfo.container.hash+"-"+index,
            fileHash:fileInfo.container.hash,
            filename:fileInfo.filename
        }))
        // console.log("选择的文件", fileInfo.data)
        await uploadChunks(uploadedList);

    }
})

//封装XMLHttpRequest

function request({
    url,method="post",
    data,
    headers={},
    onProgress =e => e,
    requestList
}){
    return new Promise(resolve=>{
        const xhr=new XMLHttpRequest();
        xhr.open(method,url);
        xhr.upload.onprogress=onProgress;
        Object.keys(headers).forEach(key=>{
            xhr.setRequestHeader(key,headers[key])
        })
        xhr.send(data);
        xhr.onload= e => {
            //将请求成功的xhr从列表中删除
            if(requestList){
                const xhrIndex=requestList.findIndex(item=>item===xhr)
                requestList.splice(xhrIndex,1)
            }

            resolve({
                data:e.target.response
            })

        }
        //暴露当前xhr给外部
        fileInfo.requestList?.push(xhr)
    })
}

//生成文件切片
function createFileChunk(file,size=SIZE){
    const fileChunkList=[];
    let cur=0;
    while(cur<file.size){
        fileChunkList.push({file:file.slice(cur,cur+size)});
        cur+=size;
    }
    console.log(fileChunkList.length,"分片数量")
    return fileChunkList;
}

//合并切片

async function mergeRequest(){
    await request({
        url:baseUrl+"/merge",
        headers:{
            "content-type":"application/json"
        },
        data:JSON.stringify({
            filename:fileInfo.filename,
            size:SIZE,
            fileHash:fileInfo.container.hash
        })
    })
}

//上传切片
async function uploadChunks(uploadedList=[]){
    const requestList=fileInfo.data.filter(({hash})=>!uploadedList.includes(hash)).map(({chunk,hash,fileHash,index,filename})=>{
        const formData=new FormData();
        formData.append("chunk",chunk);
        formData.append("hash",hash);
        formData.append("fileHash",fileHash)
        formData.append("filename",filename)
        return {formData,index}
    }).map(({formData,index})=>{
        return request({
            url:baseUrl+"/upload",
            data:formData,
            onProgress:createProgressHandler(fileInfo.data[index]),
            requestList:fileInfo.requestList
        })
    })
    //并发请求
    await Promise.all(requestList)
    //之前上传的切片数量+本次上传的切片数量=所有切片数量时合并切片
    if(uploadedList.length+requestList.length==fileInfo.data.length){
        await mergeRequest();
    }


}
//上传进度事件
function createProgressHandler(item){

    return e=>{
        let percentage=parseInt(String((e.loaded/e.total)*100));
         
      
        
        item.percentage=percentage
          // 计算总上传进度
          let loaded=fileInfo.data.map(item=>{
            // console.log(item.percentage);
            // console.log(item.size,"size");
            return (SIZE*item.percentage)/100;
        }).reduce((acc,cur)=>acc+cur,0)
        // console.log(loaded);
        
        let percentageTotal=(loaded/fileInfo.fileSize).toFixed(2)
        // console.log(percentageTotal);
    }
}

//生成文件hash(web-worker)
function calculateHash(fileChunkList){
    return new Promise(resolve=>{
        fileInfo.container.worker=new Worker('./file-hash.js')
        fileInfo.container.worker.postMessage({fileChunkList})
        fileInfo.container.worker.onmessage=e=>{
            const {percentage,hash}=e.data;
            // console.log(e.data,"hash");
            
            fileInfo.hashPercentage=percentage;
            if(hash){
                resolve(hash)
            }
        }
    })
}

//验证上传
async function verifyUpload(filename,fileHash){
    const {data} = await request({
        url:baseUrl+"/verify",
        headers:{
            "content-type":"application/json"
        },
        data:JSON.stringify({
            filename,fileHash
        })
    })
    return JSON.parse(data)
}
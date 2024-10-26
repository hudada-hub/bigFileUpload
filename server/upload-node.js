const http=require("http")
const path=require("path")
const server=http.createServer()

const fse=require('fs-extra')
const multiparty=require("multiparty")


const UPLOAD_DIR=path.resolve(__dirname,"..","upload")

//提取后缀名
const extractExt = filename=>filename.slice(filename.lastIndexOf("."),filename.name)


const resolvePost=req=>{
    return new Promise(resolve=>{
        let chunk=''
        req.on("data",data=>{
            chunk+=data;
        })
        req.on("end",()=>{
            resolve(JSON.parse(chunk))
        })
    })
}
//返回已上传的所有文件名

const createUploadedList=async (fileHash,fileName)=>{
    const chunkDir=path.resolve(UPLOAD_DIR,"chunkDir"+fileName+"-"+fileHash)
    console.log(chunkDir,"path.resolve(UPLOAD_DIR,fileHash)")
    return fse.existsSync(chunkDir)?await fse.readdir(chunkDir):[]
}


//写入文件流
const pipeStream=(path,writeSteam)=>{
    return new Promise(resolve=>{
        const readSteam=fse.createReadStream(path);
        readSteam.on("end",()=>{
            fse.unlinkSync(path)
            resolve()
        })
        readSteam.pipe(writeSteam)
    })
}
//合并切片
const mergeFileChunk=async  (filePath,fileName,fileHash,size) =>{
    const chunkDir=path.resolve(UPLOAD_DIR,"chunkDir"+fileName+"-"+fileHash)
    //获取文件夹内文件名数组
    const chunkPaths=await fse.readdir(chunkDir);

    //根据切片下标进行排序
    //否则直接读取目录的获得的顺序会错乱

    chunkPaths.sort((a,b)=>a.split("-").pop()-b.split("-").pop())


    
    //并发写入文件
    await Promise.all(chunkPaths.map((chunkPath,index)=>{
        let start=index*size;
        console.log(start,"start",index)
        return pipeStream(path.resolve(chunkDir,chunkPath),fse.createWriteStream(filePath,{
            start
        }))
    }))

    //合并删除保存切片的文件夹，文件夹内如果有文件，删除会报错
    console.log(chunkDir,"chunkDir")

    const files = await fse.readdir(chunkDir);
    if(files.length==0){
        fse.rmdirSync(chunkDir)
    }


}


server.on("request",async (req,res)=>{
    res.setHeader("Access-Control-Allow-Origin","*");
    res.setHeader("Access-Control-Allow-Headers","*");
    if(req.method=="OPTIONS"){
        res.status=200;
        res.end();
        return;
    }
    //文件秒传
    if(req.url=="/verify"){
        const data=await resolvePost(req);
        const {fileHash,filename}=data;
        const ext=extractExt(filename)
        const filePath=path.resolve(UPLOAD_DIR,`${fileHash}${ext}`)
        console.log(filePath)
        if(fse.existsSync(filePath)){
            console.log(1112)
            res.end(JSON.stringify({shouldUpload:false}))
        }else{

            console.log(3332)
            let uploadedList=await createUploadedList(fileHash,filename);
            console.log(uploadedList,"uploadedList")
            res.end(JSON.stringify({shouldUpload:true,uploadedList}))
        }
        return;
    }
    //文件合并
    if(req.url=="/merge"){
        const data=await resolvePost(req);
        console.log(data,"data");
        
        const {filename,size,fileHash}=data;

        let fname=fileHash+extractExt(filename)
        const filePath=path.resolve(UPLOAD_DIR,fname);
        console.log(filename,size,filePath);
        
        await mergeFileChunk(filePath,filename,fileHash,size)
        res.end(JSON.stringify({
            code:0,
            message:"file merged success"
        }))
        return;
    }
    if(req.url=="/upload"){
        const multipart=new multiparty.Form();
        multipart.parse(req,async (err,fields,files)=>{
            if(err)return;
            const [chunk]=files.chunk;
            const [hash]=fields.hash;
            const [fileHash]=fields.fileHash;

            const [filename]=fields.filename;
            //创建临时文件用于临时存储chunk
            //添加chunkDir 前缀与文件名做区分

            const chunkDir=path.resolve(UPLOAD_DIR,"chunkDir"+filename+"-"+fileHash);
            if(!fse.existsSync(chunkDir)){
                await fse.mkdirs(chunkDir)
            }

            //fs-extra的rename方法windows平台会有权限问题
            //@see https://github.com/meteor/meteor/issues/7852#issuecomment-255767835

            // if(!fse.existsSync(`${chunkDir}/${hash}`)){
            //     console.log(`${chunkDir}/${hash}`,1123,chunk.path);
            //
            //
            // }
            //将缓存的文件切片移动到切片文件夹中
            await fse.move(chunk.path,`${chunkDir}/${hash}`)

            res.end("received file chunk")

        })
    }

    


})

server.listen(3000,()=>console.log("监听端口3000"))
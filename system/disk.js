// const { exec } = require("child_process");

// function getDisk() {
//   return new Promise((resolve, reject) => {
//     exec("df -h", (error, stdout, stderr) => {
//       if (error) {
//         console.error(`exec error: ${error}`);
//         return reject(error);
//       }

//       // แยกบรรทัด
//       const lines = stdout.trim().split("\n");

//       // ใช้ Regular Expression เพื่อจับกลุ่มข้อมูลแต่ละคอลัมน์
//       const diskInfo = lines.slice(1).map((line) => {
//         // จับกลุ่มข้อมูลด้วย regex
//         const columns = line.match(/^(\S+\s\S+|\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)/);
        
//         if (columns) {
//           return {
//             filesystem: columns[1],  // จับไฟล์ระบบหรือ mount point
//             size: columns[2],        // ขนาดทั้งหมด
//             used: columns[3],        // ใช้ไปแล้ว
//             available: columns[4],   // พื้นที่ว่าง
//             usePercent: columns[5],  // เปอร์เซ็นต์การใช้งาน
//             mountedOn: columns[6],   // ติดตั้งบน
//           };
//         } else {
//           console.error("Error parsing line:", line);
//           return null;
//         }
//       }).filter(Boolean); // กรองค่าที่เป็น null ออกไป

//       resolve(diskInfo);
//     });
//   });
// }

// module.exports = getDisk;

// const { exec } = require("child_process");
// const os = require("os");

// function getDisk() {
//   return new Promise((resolve, reject) => {
//     const command = os.platform() === "win32" 
//       ? 'wmic logicaldisk get Caption,Size,FreeSpace,FileSystem' 
//       : 'df -h';

//     exec(command, (error, stdout, stderr) => {
//       if (error) {
//         console.error(`exec error: ${error}`);
//         return reject(error);
//       }

//       let diskInfo;

//       if (os.platform() === "win32") {
//         // Windows-specific parsing
//         const lines = stdout.trim().split("\n");
//         diskInfo = lines.slice(1).map(line => {
//           const columns = line.trim().split(/\s+/);
//           if (columns.length >= 4) {
//             const size = parseInt(columns[2]) || 0;
//             const free = parseInt(columns[1]) || 0;
//             const used = size - free;
//             const usePercent = size ? ((used / size) * 100).toFixed(2) + "%" : "0%";

//             return {
//               filesystem: columns[0],
//               size: `${(size / (1024 ** 3)).toFixed(2)}G`,
//               used: `${(used / (1024 ** 3)).toFixed(2)}G`,
//               available: `${(free / (1024 ** 3)).toFixed(2)}G`,
//               usePercent,
//               mountedOn: columns[0], // Drive letter in Windows
//             };
//           }
//           return null;
//         }).filter(Boolean);
//       } else {
//         // Unix-like parsing
//         const lines = stdout.trim().split("\n");
//         diskInfo = lines.slice(1).map(line => {
//           const columns = line.match(/^(\S+\s\S+|\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)/);
//           if (columns) {
//             return {
//               filesystem: columns[1],
//               size: columns[2],
//               used: columns[3],
//               available: columns[4],
//               usePercent: columns[5],
//               mountedOn: columns[6],
//             };
//           }
//           return null;
//         }).filter(Boolean);
//       }

//       resolve(diskInfo);
//     });
//   });
// }



const { exec } = require("child_process");
const os = require("os");

function getDisk() {
  return new Promise((resolve, reject) => {
    const command =
      os.platform() === "win32"
        ? "wmic logicaldisk get Caption,Size,FreeSpace,FileSystem"
        : "df -h";

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`exec error: ${error}`);
        return reject(error);
      }

      // แยกบรรทัด
      const lines = stdout.trim().split("\n");
      // ใช้ Regular Expression เพื่อจับกลุ่มข้อมูลแต่ละคอลัมน์
      const diskInfo = lines
        .slice(1)
        .map((line) => {
          // จับกลุ่มข้อมูลด้วย regex
          if (command != "df -h") {
            const columns = line.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/);
            if (columns) {
              const size = Math.floor(columns[4] / 1024 ** 3);
              const available = Math.floor(columns[3] / 1024 ** 3);
              const used = size - available;
              const usePercent = Math.ceil((used / size) * 100);
              const disk_mac = {
                filesystem: columns[1], // จับไฟล์ระบบหรือ mount point
                size: size + "G", // ขนาดทั้งหมด
                used: used + "G", // ใช้ไปแล้ว
                available: available + "G", // พื้นที่ว่าง
                usePercent: usePercent + "%", // เปอร์เซ็นต์การใช้งาน
                mountedOn: "", // พื้นที่ว่าง
              };
              return disk_mac;
            } else {
              console.error("Error parsing line:", line);
              return null;
            }
          } else {
            const columns = line.match(
              /^(\S+\s\S+|\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)/
            );

            if (columns) {
              const disk_win = {
                filesystem: columns[1], // จับไฟล์ระบบหรือ mount point
                size: columns[2], // ขนาดทั้งหมด
                used: columns[3], // ใช้ไปแล้ว
                available: columns[4], // พื้นที่ว่าง
                usePercent: columns[5], // เปอร์เซ็นต์การใช้งาน
                mountedOn: columns[6], // ติดตั้งบน
              };
              return disk_win;
            } else {
              console.error("Error parsing line:", line);
              return null;
            }
          }
        })
        .filter(Boolean); // กรองค่าที่เป็น null ออกไป

      resolve(diskInfo);
    });
  });
}

module.exports = getDisk; 

// getDisk().then(diskInfo => console.log(diskInfo)).catch(error => console.error(error));

